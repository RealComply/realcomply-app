import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { EMPTY_FILE_MESSAGE, finalizeEvidenceRecord } from "./evidence";

// Code review fixes, part E (12 Oct 2026): replacing a card's file puts the
// new file on the card before the old one is removed, so a save that fails
// leaves the card and its old file exactly as they were.
//
// The real Supabase client talks to a stand-in database and Storage through
// fetch, so the order of the calls is the order the app makes them. The
// listing is made up for these tests.

const AGENCY = "ag";
const LISTING = "p1";
const OLD = `${AGENCY}/${LISTING}/a3/1-agreement.pdf`;
const NEW = `${AGENCY}/${LISTING}/a3/2-agreement-signed.pdf`;

type Card = Record<string, unknown>;
let cards: Card[];
let files: Set<string>;
// What happened, in order: "read", "save", "remove <path>".
let calls: string[];
let behaviour: { read: "ok" | "fail"; save: "ok" | "fail" | "refused" };
// What Storage says each file holds, in bytes (empty files, 19 Oct 2026).
let sizes: Map<string, number>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stub() {
  mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const one = (new Headers(init?.headers).get("Accept") ?? "").includes("vnd.pgrst.object");

    const infoPrefix = "/storage/v1/object/info/compliance-evidence/";
    if (url.pathname.startsWith(infoPrefix) && method === "GET") {
      const path = decodeURIComponent(url.pathname.slice(infoPrefix.length));
      calls.push(`size ${path}`);
      if (!files.has(path)) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
      return json({ id: "f", name: path, bucket_id: "compliance-evidence", size: sizes.get(path) ?? 52_000 });
    }

    if (url.pathname === "/storage/v1/object/compliance-evidence" && method === "DELETE") {
      for (const p of body.prefixes as string[]) {
        calls.push(`remove ${p}`);
        files.delete(p);
      }
      return json([]);
    }

    if (url.pathname === "/rest/v1/property_items") {
      if (method === "GET") {
        const byCard = url.searchParams.get("item_key");
        if (byCard) {
          calls.push("read");
          if (behaviour.read === "fail") return json({ message: "connection reset" }, 500);
          const hit = cards.filter((c) => `eq.${c.item_key}` === byCard && `eq.${c.property_id}` === url.searchParams.get("property_id"));
          return json(one ? (hit[0] ?? null) : hit);
        }
        // cardFileRemovable: which cards name a path.
        const path = url.searchParams.get("evidence_path")?.slice(3);
        return json(cards.filter((c) => c.evidence_path === path).map((c) => ({ property_id: c.property_id, item_key: c.item_key })));
      }
      if (method === "POST") {
        calls.push("save");
        if (behaviour.save === "fail") return json({ message: "the database said no", code: "P0001" }, 400);
        // Refused without an error: nothing written, nothing returned.
        if (behaviour.save === "refused") return json([], 201);
        const row = body as Card;
        const i = cards.findIndex((c) => c.property_id === row.property_id && c.item_key === row.item_key);
        if (i >= 0) cards[i] = { ...cards[i], ...row };
        else cards.push(row);
        return json([{ evidence_path: row.evidence_path }], 201);
      }
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  });
}

const supabase = () => createClient("https://db.test", "service_key", { auth: { persistSession: false } });

const replace = () =>
  finalizeEvidenceRecord(supabase(), {
    agencyId: AGENCY,
    propertyId: LISTING,
    itemKey: "a3",
    path: NEW,
    fileName: "agreement-signed.pdf",
  });

const doneCard = (): Card => ({
  agency_id: AGENCY,
  property_id: LISTING,
  item_key: "a3",
  status: "done",
  data: { evidenceFileName: "agreement.pdf", agreementDate: "2026-10-01" },
  event_date: "2026-10-01",
  completed_by: "agent-1",
  evidence_path: OLD,
});

beforeEach(() => {
  cards = [doneCard()];
  // The new file is already in Storage under its own name: the browser
  // uploaded it before asking for it to be put on the card.
  files = new Set([OLD, NEW]);
  calls = [];
  behaviour = { read: "ok", save: "ok" };
  sizes = new Map();
  stub();
});

afterEach(() => mock.restoreAll());

describe("replacing a card's file", () => {
  it("normal: the card names the new file, keeps what was done on it, and only then is the old file removed", async () => {
    const { error } = await replace();

    assert.equal(error, null);
    assert.equal(cards[0].evidence_path, NEW);
    assert.equal(cards[0].status, "done", "the card stays done");
    assert.equal((cards[0].data as Record<string, unknown>).agreementDate, "2026-10-01", "what was entered stays");
    assert.equal((cards[0].data as Record<string, unknown>).evidenceFileName, "agreement-signed.pdf");
    assert.ok(!files.has(OLD), "the old file is gone");
    assert.ok(files.has(NEW));
    assert.deepEqual(calls.filter((c) => c !== "read"), [`size ${NEW}`, "save", `remove ${OLD}`], "size asked, saved, then removed");
  });

  it("the save fails: the card still names the old file, and the old file is still there", async () => {
    behaviour.save = "fail";

    const { error } = await replace();

    assert.equal(error, "the database said no");
    assert.equal(cards[0].evidence_path, OLD);
    assert.ok(files.has(OLD), "the old file was not removed");
    assert.ok(!calls.some((c) => c.startsWith("remove")));
  });

  it("the save is quietly refused (no error, nothing written): reported, and the old file is kept", async () => {
    behaviour.save = "refused";

    const { error } = await replace();

    assert.match(error ?? "", /nothing was changed/);
    assert.equal(cards[0].evidence_path, OLD);
    assert.ok(files.has(OLD));
    assert.ok(!calls.some((c) => c.startsWith("remove")));
  });

  it("the card can't be read: nothing is written, so the card is not wiped back to open", async () => {
    behaviour.read = "fail";

    const { error } = await replace();

    assert.match(error ?? "", /nothing was changed/);
    assert.deepEqual(cards[0], doneCard(), "the card is exactly as it was");
    assert.ok(files.has(OLD));
    assert.ok(!calls.includes("save"));
  });

  it("an old file another card also names is left in place", async () => {
    cards.push({ ...doneCard(), item_key: "a3b" });

    const { error } = await replace();

    assert.equal(error, null);
    assert.equal(cards[0].evidence_path, NEW);
    assert.ok(files.has(OLD), "still named by a3b, so kept");
  });

  it("an empty new file is refused with Adam's message: the card and its old file are exactly as they were", async () => {
    sizes.set(NEW, 0);

    const { error } = await replace();

    assert.equal(error, EMPTY_FILE_MESSAGE);
    assert.deepEqual(cards[0], doneCard(), "the card is exactly as it was");
    assert.ok(files.has(OLD), "the old file was not removed");
    assert.deepEqual(calls, [`size ${NEW}`], "asked the size, then nothing else");
  });

  it("an empty file on an open card: refused, and the card stays open with no file", async () => {
    cards = [{ ...doneCard(), status: "open", evidence_path: null, completed_by: null, data: {} }];
    sizes.set(NEW, 0);

    const { error } = await replace();

    assert.equal(error, EMPTY_FILE_MESSAGE);
    assert.equal(cards[0].status, "open");
    assert.equal(cards[0].evidence_path, null);
    assert.ok(!calls.includes("save"));
  });

  it("a first file on an empty card: saved, nothing removed", async () => {
    cards = [];

    const { error } = await replace();

    assert.equal(error, null);
    assert.equal(cards[0].evidence_path, NEW);
    assert.equal(cards[0].status, "open");
    assert.ok(!calls.some((c) => c.startsWith("remove")));
  });
});
