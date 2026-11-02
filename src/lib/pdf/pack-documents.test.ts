import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import { fileTypeLabel, packDocKind, packDocumentsFor, uploadedAtFromPath } from "@/lib/pdf/pack-documents";
import { readFileSync } from "node:fs";
import { AUDIT_PACK_MAX_BYTES, PACK_DOCUMENTS_MAX_BYTES, clearOldAuditPacks, storeAuditPack } from "@/lib/pdf/audit-pack-store";
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
          { evidencePath: `${FOLDER}f3/1761000000000-strata.pdf`, evidenceFileName: "Strata (made up).pdf", recordedAt: "2026-10-21T00:00:00Z" },
          { evidencePath: `${FOLDER}f3/1760500000000-pest.jpg`, evidenceFileName: "Pest (made up).jpg", recordedAt: "2026-10-15T00:00:00Z" },
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

test("the holding area keeps a pack for a day, then it goes", async () => {
  const now = Date.parse("2026-11-03T00:00:00Z");
  const stored: Record<string, Array<{ name: string; id: string | null; created_at?: string }>> = {
    "": [{ name: "agency-1", id: null }],
    "agency-1": [{ name: "listing-1", id: null }],
    "agency-1/listing-1": [
      { name: `${now - 2 * 60 * 60 * 1000}-a.pdf`, id: "1" },
      { name: `${now - 30 * 60 * 60 * 1000}-b.pdf`, id: "2" },
    ],
  };
  const removed: string[] = [];
  const bucket = {
    list: async (prefix: string) => ({ data: stored[prefix] ?? [], error: null }),
    remove: async (paths: string[]) => {
      removed.push(...paths);
      return { error: null };
    },
  };
  const service = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  assert.deepEqual(await clearOldAuditPacks(service, now), { removed: 1, problem: null });
  assert.deepEqual(removed, [`agency-1/listing-1/${now - 30 * 60 * 60 * 1000}-b.pdf`]);
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
