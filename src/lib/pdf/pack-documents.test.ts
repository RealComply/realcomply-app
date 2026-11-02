import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { DOCUMENT_TITLE, fileTypeLabel, packDocKind, packDocumentsFor, reportTitle, uploadedAtFromPath } from "@/lib/pdf/pack-documents";
import { readFileSync } from "node:fs";
import { AUDIT_PACK_MAX_BYTES, KEEP_PACK_MS, PACK_DOCUMENTS_MAX_BYTES, clearOldAuditPacks, removeAuditPacks, storeAuditPack } from "@/lib/pdf/audit-pack-store";
import type { PropertyItem } from "@/lib/types";

// Every document on the listing, in the pack's order (Adam, 2 Nov 2026).

const FOLDER = "agency-1/listing-1/";
const row = (key: string, extra: Partial<PropertyItem> & { data?: Record<string, unknown> }): PropertyItem =>
  ({ id: key, agency_id: "agency-1", property_id: "listing-1", item_key: key, status: "done", event_date: null, recorded_at: "", data: {}, evidence_path: null, extracted_date: null, completed_by: null, created_at: "", ...extra }) as PropertyItem;

test("the record's order, the current file on each card, every report on the reports card", () => {
  const items = allItemsInRuleset();
  const byKey: Record<string, PropertyItem> = {
    b1: row("b1", { evidence_path: `${FOLDER}b1/1760000000000-contract.pdf`, data: { evidenceFileName: "Contract (made up).pdf" } }),
    a3: row("a3", { evidence_path: `${FOLDER}a3/1759280400000-agreement.pdf`, data: { evidenceFileName: "Agreement (made up).pdf" } }),
    f3: row("f3", {
      data: {
        entries: [
          { evidencePath: `${FOLDER}f3/1761000000000-strata.pdf`, evidenceFileName: "Strata (made up).pdf", strata: true, recordedAt: "2026-10-21T00:00:00Z" },
          { evidencePath: `${FOLDER}f3/1760500000000-pest.jpg`, evidenceFileName: "Pest (made up).jpg", pestInspection: true, buildingInspection: true, recordedAt: "2026-10-15T00:00:00Z" },
          { evidencePath: null, recordedAt: "2026-10-16T00:00:00Z" },
        ],
      },
    }),
    // A card naming a file outside the listing's folder is left out, as everywhere.
    c1: row("c1", { evidence_path: "agency-1/another-listing/c1/1-x.pdf" }),
  };
  const uploads = new Map([[`${FOLDER}a3/1759280400000-agreement.pdf`, { by: "Ana Agent", at: "2026-10-01T01:00:00Z" }]]);
  const docs = packDocumentsFor(items, byKey, FOLDER, uploads);
  const order = items.map((i) => i.key);
  assert.ok(order.indexOf("a3") < order.indexOf("b1"), "the test assumes a3 comes before b1 in the record");
  assert.deepEqual(
    docs.map((d) => d.fileName),
    ["Agreement (made up).pdf", "Contract (made up).pdf", "Pest (made up).jpg", "Strata (made up).pdf"],
  );
  assert.equal(docs[0].uploadedBy, "Ana Agent");
  assert.equal(docs[1].uploadedBy, null, "no record of who");
  assert.equal(docs[1].uploadedAt, new Date(1760000000000).toISOString(), "the time from the stored name");
  assert.equal(docs[2].uploadedAt, "2026-10-15T00:00:00Z", "a report's entry time");
  assert.equal(docs[2].kind, "image");
  assert.ok(docs.every((d) => d.path.startsWith(FOLDER)));
  // Each named for the document it is, not the card's title (Adam, 3 Nov 2026).
  assert.deepEqual(
    docs.map((d) => d.cardTitle),
    ["Agency agreement", "Contract for sale", "Building and pest report", "Strata report"],
  );
});

test("a report on the reports card is named by what it is", () => {
  assert.equal(reportTitle({ pestInspection: true }), "Pest report");
  assert.equal(reportTitle({ buildingInspection: true }), "Building report");
  assert.equal(reportTitle({ pestInspection: true, buildingInspection: true }), "Building and pest report");
  assert.equal(reportTitle({ strata: true }), "Strata report");
  assert.equal(reportTitle({ pestInspection: true, buildingInspection: true, strata: true }), "Building and pest and strata report");
  assert.equal(reportTitle({}), "Building, pest or strata report", "a report logged from its file alone, before it was read");
});

test("every card that can hold a file has a document name, and none is a card's question", () => {
  for (const item of allItemsInRuleset()) {
    const title = DOCUMENT_TITLE[item.key];
    if (!title) continue;
    assert.ok(!title.endsWith("?"), `${item.key}: ${title}`);
    assert.notEqual(title, item.label, `${item.key} is named for the document, not the card`);
  }
  for (const key of ["a3", "a1", "a2", "a4", "b1", "b1a", "t1", "t2", "t4", "b3", "d3", "f4"]) {
    assert.ok(DOCUMENT_TITLE[key], `${key} has a document name`);
  }
});

test("a file on a card the record doesn't show is still in, never left out silently", () => {
  const items = allItemsInRuleset().filter((i) => i.key !== "a3");
  const docs = packDocumentsFor(items, { a3: row("a3", { evidence_path: `${FOLDER}a3/1759280400000-agreement.pdf` }) }, FOLDER);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].stage, "Other documents on this listing");
  assert.equal(docs[0].fileName, "agreement.pdf");
});

test("kinds and file type words", () => {
  assert.equal(packDocKind("a.PDF"), "pdf");
  assert.equal(packDocKind("IMG_1.HEIC"), "heic");
  assert.equal(packDocKind("photo.jpeg"), "image");
  assert.equal(packDocKind("letter.docx"), "other");
  assert.equal(fileTypeLabel("letter.docx"), "Word document (.docx)");
  assert.equal(fileTypeLabel("forwarded.msg"), "saved Outlook email (.msg)");
  assert.equal(fileTypeLabel("notes.txt"), ".txt file");
  assert.equal(uploadedAtFromPath("a/b/c/1760000000000-x.pdf"), new Date(1760000000000).toISOString());
  assert.equal(uploadedAtFromPath("a/b/c/x.pdf"), null);
});

/** A stand-in for the holding area: folders of entries, and what was removed. */
function holdingArea(files: string[]) {
  const stored = new Set(files);
  const removed: string[] = [];
  const bucket = {
    list: async (prefix: string) => {
      const children = new Map<string, boolean>();
      for (const f of stored) {
        if (prefix && !f.startsWith(`${prefix}/`)) continue;
        const rest = (prefix ? f.slice(prefix.length + 1) : f).split("/");
        children.set(rest[0], rest.length === 1);
      }
      return { data: [...children].map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null })), error: null };
    },
    remove: async (paths: string[]) => {
      for (const p of paths) stored.delete(p);
      removed.push(...paths);
      return { error: null };
    },
    upload: async (path: string) => {
      stored.add(path);
      return { error: null };
    },
    createSignedUrl: async () => ({ data: { signedUrl: "https://link" }, error: null }),
  };
  return { service: { storage: { from: () => bucket } } as unknown as SupabaseClient, stored, removed };
}

test("a copy lasts only as long as its download link, then the clean-up deletes it", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  assert.equal(KEEP_PACK_MS, 15 * 60 * 1000, "the 10-minute link and 5 minutes for a download under way");
  const fresh = `agency-1/listing-1/${now - 5 * 60 * 1000}-a.pdf`;
  const expired = `agency-1/listing-1/${now - 16 * 60 * 1000}-b.pdf`;
  const otherOffice = `agency-2/listing-9/${now - 2 * 60 * 60 * 1000}-c.pdf`;
  const { service, stored } = holdingArea([fresh, expired, otherOffice]);
  assert.deepEqual(await clearOldAuditPacks(service, now), { removed: 2, problem: null });
  assert.deepEqual([...stored], [fresh]);
});

test("making a new pack clears that listing's packs whose links have run out, and no other listing's", async () => {
  const old = `agency-1/listing-1/${Date.now() - 60 * 60 * 1000}-old.pdf`;
  const otherListing = `agency-1/listing-2/${Date.now() - 60 * 60 * 1000}-other.pdf`;
  const { service, stored } = holdingArea([old, otherListing]);
  const pdf = new Uint8Array(10);
  assert.equal(await storeAuditPack(service, { pdf, filename: "x.pdf" }, { agencyId: "agency-1", propertyId: "listing-1" }), "https://link");
  assert.ok(!stored.has(old), "the expired pack for this listing is gone");
  assert.ok(stored.has(otherListing), "another listing's waits for the hourly clean-up");
  assert.equal([...stored].filter((p) => p.startsWith("agency-1/listing-1/")).length, 1, "the new one is there");
});

test("an office's or a listing's packs are all removed, whatever their age, and it looks again", async () => {
  const now = Date.now();
  const { service, stored } = holdingArea([
    `agency-1/listing-1/${now}-a.pdf`,
    `agency-1/listing-2/${now}-b.pdf`,
    `agency-2/listing-9/${now}-c.pdf`,
  ]);
  assert.deepEqual(await removeAuditPacks(service, "agency-1/listing-1"), { removed: 1, left: 0, problem: null });
  assert.deepEqual(await removeAuditPacks(service, "agency-1"), { removed: 1, left: 0, problem: null });
  assert.deepEqual([...stored], [`agency-2/listing-9/${now}-c.pdf`], "another office's are untouched");
  assert.equal((await removeAuditPacks(service, "")).problem, "no folder given", "never the whole holding area by mistake");
});

test("the report on the ESP card is named as the comparative market analysis, not by the card's title", () => {
  const docs = packDocumentsFor(
    allItemsInRuleset(),
    { a4: row("a4", { evidence_path: `${FOLDER}a4/1759280400000-cma.pdf`, data: { evidenceFileName: "CMA (made up).pdf", espLow: 750000, espHigh: 790000 } }) },
    FOLDER,
  );
  assert.equal(docs.length, 1);
  assert.equal(docs[0].cardTitle, "Comparative market analysis");
  assert.equal(docs[0].stage, "Listing set-up");
  assert.equal(docs[0].fileName, "CMA (made up).pdf");
});

test("the holding area takes a 500 MB pack, the same limit 0106 sets on the bucket; a pack holds 450 MB of documents", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0106_audit_pack_documents.sql", import.meta.url), "utf8");
  assert.equal(AUDIT_PACK_MAX_BYTES, 500 * 1024 * 1024);
  assert.match(sql, /values \('audit-packs', 'audit-packs', false, 500 \* 1024 \* 1024,/);
  assert.match(sql, /file_size_limit = 500 \* 1024 \* 1024,/);
  assert.match(sql, /file_size_limit = 524288000/);
  // Room for the record, the contents and separators, and a PDF growing a little as it's copied.
  assert.ok(PACK_DOCUMENTS_MAX_BYTES <= AUDIT_PACK_MAX_BYTES * 0.9);
});

test("a pack over the holding area's limit is refused before anything is uploaded", async () => {
  let uploads = 0;
  const service = {
    storage: { from: () => ({ upload: async () => { uploads++; return { error: null }; }, createSignedUrl: async () => ({ data: { signedUrl: "x" }, error: null }) }) },
  } as unknown as SupabaseClient;
  const pdf = { length: AUDIT_PACK_MAX_BYTES + 1 } as unknown as Uint8Array;
  await assert.rejects(storeAuditPack(service, { pdf, filename: "x.pdf" }, { agencyId: "a", propertyId: "p" }), /over the holding area's limit/);
  assert.equal(uploads, 0);
});
