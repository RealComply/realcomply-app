import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CMA_REREADS,
  cmaRereadListings,
  cmaRereadSummary,
  rereadComparablesReport,
  type CmaReread,
} from "@/lib/documents/cma-reread";
import { LISTING_READER_MAX_TOKENS } from "@/lib/documents/listing-reader";
import type { ReaderAlert } from "@/lib/documents/read-record";
import { loadSampleCma, type SampleCmaFile } from "@/lib/documents/sample-cmas";

// Re-reading the three comparable-sales reports Adam asked for (2 Nov 2026).
// Run here on a MADE-UP listing (made-up office, address, agent's words and
// sales) in an in-memory database, with one of the made-up sample reports
// (samples/cma) and a stand-in reader that answers with what a correct read
// of it gives. Only the listing's id is one of the three, because only those
// three can be re-read.

type Row = Record<string, unknown>;

const LISTING = CMA_REREADS[2].propertyId;
const OFFICE = "aaaaaaaa-0000-4000-8000-000000000001";
const FILE = `${OFFICE}/${LISTING}/a4/1792877468798-sample_report.pdf`;
const NOW = new Date("2026-11-02T01:00:00Z"); // 12pm in Sydney, 2 Nov

let sample: SampleCmaFile;
before(async () => {
  sample = await loadSampleCma("corelogic-style"); // 12 sales, 4 listings on the market
});

/** An in-memory stand-in for the service client: the tables, and the stored file. */
function fakeService(tables: Record<string, Row[]>, files: Record<string, Uint8Array>) {
  let nextId = 1;
  const stamp = (row: Row): Row => ({ id: `row-${nextId++}`, created_at: NOW.toISOString(), ...row });
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      order: () => q,
      eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), q),
      is: (col: string, value: unknown) => (filters.push((r) => (r[col] ?? null) === value), q),
      in: (col: string, values: unknown[]) => (filters.push((r) => values.includes(r[col])), q),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: <U>(resolve: (r: { data: Row[]; error: null }) => U, reject?: (e: unknown) => U) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
      insert: async (row: Row | Row[]) => {
        (tables[table] ??= []).push(...(Array.isArray(row) ? row : [row]).map(stamp));
        return { error: null };
      },
      update: (values: Row) => {
        const where: ((r: Row) => boolean)[] = [];
        const u = {
          eq: (col: string, value: unknown) => (where.push((r) => r[col] === value), u),
          then: <U>(resolve: (r: { error: null }) => U, reject?: (e: unknown) => U) => {
            for (const r of tables[table] ?? []) if (where.every((f) => f(r))) Object.assign(r, values);
            return Promise.resolve({ error: null }).then(resolve, reject);
          },
        };
        return u;
      },
      upsert: (row: Row, options: { onConflict: string; ignoreDuplicates: boolean }) => ({
        select: async () => {
          const there = (tables[table] ??= []).some((r) => r[options.onConflict] === row[options.onConflict]);
          if (there) return { data: [], error: null };
          tables[table].push(row);
          return { data: [row], error: null };
        },
      }),
    };
    return q;
  }
  const storage = {
    from: () => ({
      download: async (path: string) =>
        files[path]
          ? { data: new Blob([Buffer.from(files[path])], { type: "application/pdf" }), error: null }
          : { data: null, error: { message: "Object not found" } },
    }),
  };
  return { from, storage } as unknown as SupabaseClient;
}

/** A stand-in reader that knows the one sample, and keeps a limit like the real one. */
function standInReader(answer: Record<string, unknown>, { cap = Infinity } = {}) {
  let calls = 0;
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    calls++;
    const tool = (params.tool_choice as { name: string }).name;
    const fits = JSON.stringify(answer).length / 3 <= Math.min(params.max_tokens, cap);
    return {
      id: "msg_sample",
      type: "message",
      role: "assistant",
      model: params.model,
      stop_reason: fits ? "tool_use" : "max_tokens",
      stop_sequence: null,
      content: [{ type: "tool_use", id: "toolu_sample", name: tool, input: fits ? answer : { documentIs: answer.documentIs, patches: [] } }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
  return { calls: () => calls, client: { messages: { create } } as unknown as Anthropic };
}

/** A made-up listing: the ESP typed, the agent's reasoning done, one sale the agent typed themselves. */
function madeUpListing(over: { esp?: boolean; details?: boolean } = {}) {
  const firstSale = (sample.answer.patches as Array<{ comparableSales?: Array<{ address: string }> }>)[1].comparableSales![0];
  const tables: Record<string, Row[]> = {
    agencies: [{ id: OFFICE, name: "Sample Realty (made up)" }],
    properties: [
      {
        id: LISTING,
        agency_id: OFFICE,
        address: "12 Sample Street, Testville NSW 2999",
        agencies: { name: "Sample Realty (made up)" },
        is_strata: false,
        property_type: "House",
        bedrooms: over.details === false ? null : 3,
        bathrooms: over.details === false ? null : 2,
        car_spaces: over.details === false ? null : 1,
        land_size_sqm: over.details === false ? null : 600,
        internal_area_sqm: null,
        attribute_suggestions: null,
        attributes_confirmed_at: null,
      },
    ],
    property_items: [
      { property_id: LISTING, item_key: "a3", status: "done", data: {}, evidence_path: null, event_date: "2026-10-12" },
      {
        property_id: LISTING,
        item_key: "a4",
        status: "done",
        evidence_path: FILE,
        event_date: null,
        data: over.esp === false ? { evidenceFileName: "sample report.pdf" } : { espLow: 1180000, espHigh: 1260000, evidenceFileName: "sample report.pdf" },
      },
      {
        property_id: LISTING,
        item_key: "a4c",
        status: "done",
        evidence_path: null,
        event_date: null,
        data: { note: "My own reasoning, typed and ticked.", reasoningAdoption: { at: "2026-10-28T03:00:00Z" } },
      },
    ],
    // The agent typed this sale themselves, and relied on it: the report has
    // it too, written "St" where the agent wrote "Street".
    property_comparables: [
      {
        id: "agent-sale",
        agency_id: OFFICE,
        property_id: LISTING,
        address: firstSale.address.replace(/\bRoad\b/, "Rd"),
        sale_price: 1325000,
        source: "agent",
        weighting: "relied",
        agent_note: "Same street, smaller block.",
        position: 0,
      },
    ],
    property_market_listings: [],
    document_reads: [],
    reader_alerts: [],
  };
  return { tables, files: { [FILE]: sample.bytes } };
}

function recorder() {
  const sent: ReaderAlert[] = [];
  const pending: Promise<unknown>[] = [];
  return {
    sent,
    settled: () => Promise.all(pending),
    options: {
      now: () => NOW,
      record: { send: async (a: ReaderAlert) => void sent.push(a), later: (task: () => Promise<unknown>) => void pending.push(task()) },
    },
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const itemOf = (tables: Record<string, Row[]>, key: string) => tables.property_items.find((i) => i.item_key === key)!;

describe("re-reading a comparable-sales report from the staff page", () => {
  it("adds the report's sales and listings, and puts the read's result on the ESP card", async () => {
    const { tables, files } = madeUpListing();
    const reader = standInReader(sample.answer);
    const out = recorder();
    const result = (await rereadComparablesReport(fakeService(tables, files), reader.client, LISTING, out.options)) as CmaReread;
    await out.settled();

    assert.equal(result.read.outcome, "read");
    assert.equal(result.read.sales, 12);
    assert.equal(result.read.listings, 4);
    assert.equal(result.salesAdded, 11, "the sale the agent typed isn't added again");
    assert.equal(result.listingsAdded, 4);
    assert.equal(result.salesOnListing, 12);
    assert.equal(result.listingsOnListing, 4);
    assert.equal(tables.property_comparables.filter((c) => c.source === "report").length, 11);
    assert.ok(tables.property_comparables.filter((c) => c.source === "report").every((c) => c.weighting === undefined), "no weighting written");
    assert.deepEqual(itemOf(tables, "a4").data, {
      espLow: 1180000,
      espHigh: 1260000,
      evidenceFileName: "sample report.pdf",
      reportRead: { at: NOW.toISOString(), path: FILE, outcome: "read", sales: 12, listings: 4 },
    });
    assert.equal(reader.calls(), 1);
  });

  it("never changes the ESP, a note, the reasoning, a tick, a card's status, the agent's rows or the listing's details", async () => {
    const { tables, files } = madeUpListing();
    const before = clone(tables);
    await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer).client, LISTING, recorder().options);

    assert.deepEqual(tables.properties, before.properties, "the listing's details, and no suggestions offered");
    assert.deepEqual(itemOf(tables, "a3"), itemOf(before, "a3"));
    assert.deepEqual(itemOf(tables, "a4c"), itemOf(before, "a4c"), "the agent's reasoning, its tick and status");
    const a4 = itemOf(tables, "a4");
    const { reportRead, ...a4Data } = a4.data as Row;
    assert.ok(reportRead);
    assert.deepEqual({ ...a4, data: a4Data }, itemOf(before, "a4"), "only the read's result is added to the ESP card");
    assert.deepEqual(tables.property_comparables[0], before.property_comparables[0], "the agent's own sale, untouched");
  });

  it("adds nothing the second time", async () => {
    const { tables, files } = madeUpListing();
    const service = fakeService(tables, files);
    await rereadComparablesReport(service, standInReader(sample.answer).client, LISTING, recorder().options);
    const again = (await rereadComparablesReport(service, standInReader(sample.answer).client, LISTING, recorder().options)) as CmaReread;
    assert.equal(again.salesAdded, 0);
    assert.equal(again.listingsAdded, 0);
    assert.equal(tables.property_comparables.length, 12);
    assert.equal(tables.property_market_listings.length, 4);
  });

  it("is recorded like any other read, against the listing's office, with no alert for a good read", async () => {
    const { tables, files } = madeUpListing();
    const out = recorder();
    await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer).client, LISTING, out.options);
    await out.settled();
    assert.deepEqual(
      tables.document_reads.map(({ agency_id, property_id, reader, outcome, why, sales }) => ({ agency_id, property_id, reader, outcome, why, sales })),
      [{ agency_id: OFFICE, property_id: LISTING, reader: "comparable_sales", outcome: "read", why: null, sales: 12 }],
    );
    assert.deepEqual(tables.reader_alerts, []);
    assert.deepEqual(out.sent, []);
  });

  it("says whether Draft my reasoning works now, and leaves the agent's reasoning as it is", async () => {
    const { tables, files } = madeUpListing();
    const result = (await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer).client, LISTING, recorder().options)) as CmaReread;
    assert.equal(result.draft.available, true);
    assert.equal(result.reasoningDone, true);
    const summary = cmaRereadSummary(result);
    assert.match(summary, /^12 Sample Street, Testville NSW 2999 \(Sample Realty \(made up\)\): read to the end\./);
    assert.match(summary, /The report has 12 sales and 4 listings on the market\. Added 11 sales and 4 listings; the listing now has 12 sales and 4 listings on the market\./);
    assert.match(summary, /"Draft my reasoning" works now: /);
    assert.match(summary, /The agent's own reasoning is already done and ticked, and stays as it is\.$/);
    assert.doesNotMatch(summary, /—/, "no em dashes");
  });

  it("says when Draft my reasoning can't work yet, and why", async () => {
    for (const [over, words] of [
      [{ esp: false }, /isn't available: no estimated selling price is recorded on the ESP card\./],
      [{ details: false }, /isn't available: the listing's details \(bedrooms, bathrooms, land size, internal area\) aren't recorded\./],
    ] as const) {
      const { tables, files } = madeUpListing(over);
      const result = (await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer).client, LISTING, recorder().options)) as CmaReread;
      assert.equal(result.draft.available, false);
      assert.match(cmaRereadSummary(result), words);
    }
  });
});

describe("a re-read that fails", () => {
  it("changes nothing on the listing, is recorded and alerted, and says so", async () => {
    const { tables, files } = madeUpListing();
    const before = clone(tables);
    const out = recorder();
    // The answer is cut off at the reader's length limit.
    const result = (await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer, { cap: 200 }).client, LISTING, out.options)) as CmaReread;
    await out.settled();

    assert.equal(result.read.outcome, "failed");
    assert.equal(result.failedBecause, "cut_off");
    assert.deepEqual(tables.properties, before.properties);
    assert.deepEqual(tables.property_items, before.property_items, "no failed result put on the agent's card");
    assert.deepEqual(tables.property_comparables, before.property_comparables);
    assert.deepEqual(tables.property_market_listings, []);
    assert.deepEqual(
      tables.document_reads.map(({ outcome, why, sales }) => ({ outcome, why, sales })),
      [{ outcome: "failed", why: "cut_off", sales: 0 }],
    );
    assert.deepEqual(tables.reader_alerts.map((a) => a.alert_key), [`listing:${LISTING}:2026-11-02`], "the database's own key");
    assert.equal(out.sent.length, 1);
    assert.equal(out.sent[0].office, "Sample Realty (made up)");
    assert.equal(out.sent[0].listing, "12 Sample Street, Testville NSW 2999");
    assert.equal(out.sent[0].unrecorded, undefined);
    assert.match(
      cmaRereadSummary(result),
      /couldn't be read: the reader's answer hit its length limit and was cut off\. Nothing on the listing changed\./,
    );
  });

  it("isn't emailed twice on a day the listing has already had its alert", async () => {
    const { tables, files } = madeUpListing();
    tables.reader_alerts.push({ alert_key: `listing:${LISTING}:2026-11-02`, agency_id: OFFICE, property_id: LISTING });
    const out = recorder();
    await rereadComparablesReport(fakeService(tables, files), standInReader(sample.answer, { cap: 200 }).client, LISTING, out.options);
    await out.settled();
    assert.deepEqual(tables.document_reads.map((r) => r.outcome), ["failed"], "recorded");
    assert.deepEqual(out.sent, [], "not emailed again");
  });

  it("says so when the file can't be downloaded", async () => {
    const { tables } = madeUpListing();
    const reader = standInReader(sample.answer);
    const result = (await rereadComparablesReport(fakeService(tables, {}), reader.client, LISTING, recorder().options)) as CmaReread;
    assert.equal(result.read.outcome, "failed");
    assert.equal(result.failedBecause, "file");
    assert.equal(reader.calls(), 0);
    assert.match(cmaRereadSummary(result), /couldn't be read: the file couldn't be downloaded\./);
  });
});

describe("which listings can be re-read", () => {
  it("only the three Adam named, in his order", () => {
    assert.deepEqual(
      CMA_REREADS.map((r) => [r.propertyId, r.listing]),
      [
        ["27bcc7fb-e028-4c0d-9d49-2292741e5dc0", "6 Markham Close, Mosman (Raine & Horne Mosman | Neutral Bay)"],
        ["4b926ebd-8331-4739-85b6-7c17acd77f6e", "36/86 Derrima Road, Crestwood (Raine & Horne Queanbeyan)"],
        ["a4eb5ea0-49c1-4cd3-acb4-8ab1006d0249", "19 Park Street, Uralla (Uralla Properties)"],
      ],
    );
  });

  it("refuses any other listing, before reading or writing anything", async () => {
    const { tables, files } = madeUpListing();
    const before = clone(tables);
    const reader = standInReader(sample.answer);
    const result = await rereadComparablesReport(fakeService(tables, files), reader.client, "11111111-2222-4333-8444-555555555555", recorder().options);
    assert.deepEqual(result, { error: "That listing isn't one of the three to re-read." });
    assert.equal(reader.calls(), 0);
    assert.deepEqual(tables, before);
  });

  it("are listed on the staff page as they stand", async () => {
    const { tables, files } = madeUpListing();
    const service = fakeService(tables, files);
    const listed = await cmaRereadListings(service);
    assert.equal(listed.length, 3);
    const mine = listed.find((l) => l.propertyId === LISTING)!;
    assert.deepEqual(
      { ...mine },
      {
        propertyId: LISTING,
        address: "12 Sample Street, Testville NSW 2999",
        office: "Sample Realty (made up)",
        fileName: "sample report.pdf",
        salesOnListing: 1,
        listingsOnListing: 0,
        lastRead: null,
      },
    );
    assert.equal(listed.find((l) => l.propertyId !== LISTING)!.office, "Office not found");

    await rereadComparablesReport(service, standInReader(sample.answer).client, LISTING, recorder().options);
    const after = (await cmaRereadListings(service)).find((l) => l.propertyId === LISTING)!;
    assert.equal(after.salesOnListing, 12);
    assert.equal(after.lastRead?.outcome, "read");
  });

  it("are read with the reader's own limit", () => {
    assert.ok(LISTING_READER_MAX_TOKENS >= 8000);
  });
});
