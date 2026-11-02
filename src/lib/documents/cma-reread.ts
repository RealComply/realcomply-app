import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { comparablesFor, subjectAttributesFrom } from "@/lib/data/comparables";
import { draftEspReasoning, type EvidenceVerdict } from "@/lib/data/esp-draft";
import { marketListingsFor } from "@/lib/data/market-listings";
import { readListingDocument } from "@/lib/documents/listing-reader";
import { FileCantBeRead, readFailureWhy, type ReadFailureWhy } from "@/lib/documents/read-core";
import { noteRead, staffReadRecord } from "@/lib/documents/read-record";
import { reportReadFrom, reportReadOf, type ReportRead } from "@/lib/documents/report-read";
import { addReportRows } from "@/lib/documents/report-rows";
import { prescribedDocumentsFor } from "@/lib/rules/nsw-prescribed-documents";
import { getItem } from "@/lib/rules/nsw-sales";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { downloadedFileProblem } from "@/lib/storage/file-check";

// RE-READING THREE COMPARABLE-SALES REPORTS (Adam, 2 Nov 2026).
//
// Before the fix of 31 Oct (#95) a comparable-sales report's answer could be
// cut off at the reader's length limit and pass for "no sales found". Three
// live listings were read that way and still show no sales. Adam: re-read the
// CMA on these listings only, don't change anything typed or confirmed, and
// report the comparables found and whether a reasoning draft is available.
// Cass and Comply listings created before 8 Sep are left alone.
//
// Run from the staff page by RealComply staff, one listing at a time, and
// only for the three below. A re-read ADDS the report's sales and on-market
// listings the listing doesn't have yet (lib/documents/report-rows: the
// agent's own rows are never changed) and puts the read's result on the ESP
// card (a4), as the agent's own "Read again" does, so the cards show it and
// "Draft my reasoning" can use the sales. It never changes the ESP, a note,
// the reasoning, a tick, a card's status, the AI's suggestions on the cards,
// or the listing's details. A read that fails changes nothing on the listing:
// it is recorded and emailed like any other failed read, and said here.

export const CMA_REREADS: ReadonlyArray<{ propertyId: string; listing: string }> = [
  {
    propertyId: "27bcc7fb-e028-4c0d-9d49-2292741e5dc0",
    listing: "6 Markham Close, Mosman (Raine & Horne Mosman | Neutral Bay)",
  },
  {
    propertyId: "4b926ebd-8331-4739-85b6-7c17acd77f6e",
    listing: "36/86 Derrima Road, Crestwood (Raine & Horne Queanbeyan)",
  },
  {
    propertyId: "a4eb5ea0-49c1-4cd3-acb4-8ab1006d0249",
    listing: "19 Park Street, Uralla (Uralla Properties)",
  },
];

export function isCmaReread(propertyId: string): boolean {
  return CMA_REREADS.some((r) => r.propertyId === propertyId);
}

/** Whether "Draft my reasoning" would write a draft now, and what it would say about the estimate. */
export type DraftNow = { available: true; evidence: EvidenceVerdict } | { available: false; why: "no_estimate" | "no_details" };

export type CmaReread = {
  propertyId: string;
  address: string;
  office: string;
  fileName: string;
  /** What the read came to. A failed read is said here and not put on the card. */
  read: ReportRead;
  /** Why it failed, when it did. */
  failedBecause?: ReadFailureWhy;
  salesAdded: number;
  listingsAdded: number;
  /** On the listing after the re-read. */
  salesOnListing: number;
  listingsOnListing: number;
  draft: DraftNow;
  /** The ESP reasoning card (a4c) is done: the agent's own reasoning, ticked. */
  reasoningDone: boolean;
  /** Plain words, when something after the read couldn't be written. */
  problems: string[];
};

/** A listing on the staff page, before or after its re-read. */
export type CmaRereadListing = {
  propertyId: string;
  address: string;
  office: string;
  fileName: string | null;
  salesOnListing: number;
  listingsOnListing: number;
  /** The read on the ESP card for the file there now; null when none is recorded. */
  lastRead: ReportRead | null;
};

type Row = Record<string, unknown>;
type Item = { item_key: string; status: string | null; data: Row | null; evidence_path: string | null; event_date: string | null };

const ESP_CARD = "a4";

function cardName(itemKey: string): string {
  const label = getItem(itemKey)?.label;
  return label ? `${label} (${itemKey})` : itemKey;
}

async function loadListing(service: SupabaseClient, propertyId: string) {
  const { data: property } = await service.from("properties").select("*").eq("id", propertyId).maybeSingle();
  const row = (property ?? null) as Row | null;
  if (!row) return null;
  const { data: agency } = await service.from("agencies").select("name").eq("id", row.agency_id as string).maybeSingle();
  const { data: items } = await service
    .from("property_items")
    .select("item_key, status, data, evidence_path, event_date")
    .eq("property_id", propertyId)
    .in("item_key", ["a3", ESP_CARD, "a4c"]);
  const byKey = new Map(((items ?? []) as Item[]).map((i) => [i.item_key, i]));
  return {
    row,
    office: String((agency as { name?: string } | null)?.name ?? "").trim(),
    a3: byKey.get("a3") ?? null,
    a4: byKey.get(ESP_CARD) ?? null,
    a4c: byKey.get("a4c") ?? null,
  };
}

function fileNameOf(a4: Item | null): string | null {
  if (!a4?.evidence_path) return null;
  return (a4.data as { evidenceFileName?: string } | null)?.evidenceFileName ?? a4.evidence_path.split("/").pop() ?? "document";
}

/** The three listings as they stand, for the staff page. */
export async function cmaRereadListings(service: SupabaseClient): Promise<CmaRereadListing[]> {
  const out: CmaRereadListing[] = [];
  for (const { propertyId, listing } of CMA_REREADS) {
    const found = await loadListing(service, propertyId);
    const [sales, listings] = found
      ? await Promise.all([comparablesFor(service, propertyId), marketListingsFor(service, propertyId)])
      : [[], []];
    out.push({
      propertyId,
      address: String(found?.row.address ?? listing),
      office: found?.office || "Office not found",
      fileName: fileNameOf(found?.a4 ?? null),
      salesOnListing: sales.length,
      listingsOnListing: listings.length,
      lastRead: reportReadOf(found?.a4?.data, found?.a4?.evidence_path),
    });
  }
  return out;
}

/** What "Draft my reasoning" would do with the listing as it now stands. */
async function draftNow(service: SupabaseClient, propertyId: string): Promise<{ draft: DraftNow; sales: number; listings: number }> {
  const found = await loadListing(service, propertyId);
  const [comparables, listings] = await Promise.all([comparablesFor(service, propertyId), marketListingsFor(service, propertyId)]);
  const espData = (found?.a4?.data ?? {}) as { espLow?: number | string | null; espHigh?: number | string | null };
  const figure = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
  const subject = subjectAttributesFrom(found?.row ?? null);
  const result = draftEspReasoning({
    esp: { low: figure(espData.espLow), high: figure(espData.espHigh) },
    subject,
    subjectType: (found?.row.property_type as string | null) ?? null,
    comparables,
    listings,
    agreementDate: found?.a3?.event_date ?? null,
    noneOnMarketConfirmed: Boolean((found?.a4c?.data as { noneOnMarket?: boolean } | null)?.noneOnMarket),
  });
  const draft: DraftNow =
    result.kind === "draft"
      ? { available: true, evidence: result.evidence }
      : { available: false, why: result.reason === "no_estimate" ? "no_estimate" : "no_details" };
  return { draft, sales: comparables.length, listings: listings.length };
}

/**
 * Re-reads one listing's comparable-sales report with the reader as it is
 * now, and adds what it finds. One of the three listings only. Never throws
 * for a read that fails: that is the result.
 */
export async function rereadComparablesReport(
  service: SupabaseClient,
  anthropic: Anthropic,
  propertyId: string,
  options: { now?: () => Date; record?: Parameters<typeof noteRead>[2] } = {},
): Promise<CmaReread | { error: string }> {
  if (!isCmaReread(propertyId)) return { error: "That listing isn't one of the three to re-read." };
  const now = options.now ?? (() => new Date());

  const found = await loadListing(service, propertyId);
  if (!found) return { error: "That listing isn't on RealComply any more." };
  const path = found.a4?.evidence_path;
  if (!path) return { error: "There's no comparable-sales report on that listing's ESP card any more." };
  const fileName = fileNameOf(found.a4)!;
  const agencyId = String(found.row.agency_id);
  const reasoningDone = found.a4c?.status === "done";
  const note = { reader: "comparable_sales" as const, card: cardName(ESP_CARD), fileName, propertyId };
  const record = staffReadRecord(service, agencyId, now);
  const at = now().toISOString();

  let read: ReportRead;
  let added = { salesAdded: 0, listingsAdded: 0, problems: [] as string[] };
  try {
    const { data: blob, error } = await service.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) throw new FileCantBeRead("file", "the file couldn't be downloaded");
    const unreadable = await downloadedFileProblem(blob, path.split("/").pop() ?? fileName);
    if (unreadable) throw new FileCantBeRead("file", unreadable);
    const patches = await readListingDocument({
      anthropic,
      blob,
      fileName,
      source: ESP_CARD,
      prescribedDocs: prescribedDocumentsFor({ isStrata: (found.row.is_strata as boolean | null) ?? false }),
    });
    read = reportReadFrom(patches, path, at);
    // The rows only: never the AI's suggestions on the cards, nor the
    // listing's details, so nothing the agent typed or confirmed is touched.
    const rows = patches.find((p) => p.itemKey === "a4c" && ((p.comparableSales?.length ?? 0) > 0 || (p.marketListings?.length ?? 0) > 0));
    if (rows) added = await addReportRows(service, { agencyId, propertyId }, rows);
  } catch (err) {
    const why = readFailureWhy(err);
    await noteRead(record, { ...note, outcome: "failed", why, error: err }, options.record);
    const { draft, sales, listings } = await draftNow(service, propertyId);
    return {
      propertyId,
      address: String(found.row.address ?? ""),
      office: found.office,
      fileName,
      read: { at, path, outcome: "failed", message: failedWords(why, err) },
      failedBecause: why,
      salesAdded: 0,
      listingsAdded: 0,
      salesOnListing: sales,
      listingsOnListing: listings,
      draft,
      reasoningDone,
      problems: [],
    };
  }

  // The read's result on the ESP card, over its latest copy, as the agent's
  // own read does: the card then says what the report held, and "Draft my
  // reasoning" knows it has been read. Nothing else on the card changes.
  const { data: a4Now } = await service
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", ESP_CARD)
    .maybeSingle();
  const a4Data = ((a4Now as { data?: Row | null } | null)?.data ?? {}) as Row;
  const { error: cardError } = await service
    .from("property_items")
    .update({ data: { ...a4Data, reportRead: read } })
    .eq("property_id", propertyId)
    .eq("item_key", ESP_CARD);
  const problems = [...added.problems];
  if (cardError) problems.push(`the result couldn't be put on the ESP card (${cardError.message})`);

  await noteRead(record, { ...note, outcome: read.outcome, sales: read.sales ?? 0 }, options.record);

  const { draft, sales, listings } = await draftNow(service, propertyId);
  return {
    propertyId,
    address: String(found.row.address ?? ""),
    office: found.office,
    fileName,
    read,
    salesAdded: added.salesAdded,
    listingsAdded: added.listingsAdded,
    salesOnListing: sales,
    listingsOnListing: listings,
    draft,
    reasoningDone,
    problems,
  };
}

const WHY_WORDS: Record<ReadFailureWhy, string> = {
  cut_off: "the reader's answer hit its length limit and was cut off",
  unparseable: "the reader's answer couldn't be used",
  refused: "the reader declined to answer",
  no_answer: "the reader gave no answer",
  too_large: "the file is too large for the reader",
  unsupported: "the file is a kind the reader can't take",
  file: "the file couldn't be opened",
  service: "the AI service returned an error (busy, overloaded or down)",
  other: "something else went wrong (Vercel's logs have it: search for \"document read failed\")",
};

function failedWords(why: ReadFailureWhy, err: unknown): string {
  if (why === "file" && err instanceof FileCantBeRead) return err.message;
  return WHY_WORDS[why];
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const VERDICT_WORDS: Record<EvidenceVerdict, string> = {
  supports: "the sales sit around the estimate",
  mostly_above: "most of the sales sit above the estimate, so the draft says that and doesn't argue the estimate is supported",
  mostly_below: "most of the sales sit below the estimate, so the draft says that and doesn't argue the estimate is supported",
  too_few: "there are too few sales to judge the estimate on, and the draft says so",
};

/** The result in plain words, for the staff page. */
export function cmaRereadSummary(r: CmaReread): string {
  const where = `${r.address} (${r.office})`;
  const draft = r.draft.available
    ? `"Draft my reasoning" works now: ${VERDICT_WORDS[r.draft.evidence]}.`
    : r.draft.why === "no_estimate"
      ? `"Draft my reasoning" isn't available: no estimated selling price is recorded on the ESP card.`
      : `"Draft my reasoning" isn't available: the listing's details (bedrooms, bathrooms, land size, internal area) aren't recorded.`;
  const reasoning = r.reasoningDone
    ? "The agent's own reasoning is already done and ticked, and stays as it is."
    : "The agent hasn't done the ESP reasoning yet.";
  const problems = r.problems.length > 0 ? ` But ${r.problems.join(", and ")}.` : "";

  switch (r.read.outcome) {
    case "failed":
      return (
        `${where}: the report couldn't be read: ${r.read.message ?? "no reason given"}. Nothing on the listing changed. ` +
        "The failed read is recorded and alerted like any other. Try again in a minute."
      );
    case "wrong_document":
      return (
        `${where}: the file on the ESP card isn't a comparable-sales report (it looks like ${r.read.message ?? "something else"}). ` +
        "Nothing was added. The ESP card now says so."
      );
    case "nothing_found":
      return `${where}: read to the end, but no sales or listings were found in the report. Nothing was added. ${draft} ${reasoning}${problems}`;
    case "read":
      return (
        `${where}: read to the end. The report has ${count(r.read.sales ?? 0, "sale")} and ` +
        `${count(r.read.listings ?? 0, "listing")} on the market. Added ${count(r.salesAdded, "sale")} and ` +
        `${count(r.listingsAdded, "listing")}; the listing now has ${count(r.salesOnListing, "sale")} and ` +
        `${count(r.listingsOnListing, "listing")} on the market. ${draft} ${reasoning}${problems}`
      );
  }
}
