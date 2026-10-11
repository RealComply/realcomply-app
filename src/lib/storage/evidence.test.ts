import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EVIDENCE_BUCKET,
  MAX_EVIDENCE_BYTES,
  TOO_LARGE_MESSAGE,
  WRONG_TYPE_MESSAGE,
  cardFileRemovable,
  cpdFolder,
  evidenceContentType,
  evidenceFileProblem,
  isInFolder,
  listingFolder,
  listPropertyEvidencePaths,
} from "./evidence";

// A bucket as storage.list() shows it: one level at a time, a folder with no
// id, paged by limit/offset.
function fakeClient(objects: string[], failOn?: string) {
  const listed: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, EVIDENCE_BUCKET);
        return {
          async list(prefix: string, { limit, offset }: { limit: number; offset: number }) {
            listed.push(prefix);
            if (prefix === failOn) return { data: null, error: { message: "denied" } };
            const names = new Map<string, boolean>();
            for (const path of objects) {
              if (!path.startsWith(`${prefix}/`)) continue;
              const [first, ...rest] = path.slice(prefix.length + 1).split("/");
              names.set(first, rest.length === 0 || names.get(first) === true);
            }
            const entries = [...names.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([name, isFile]) => ({ name, id: isFile ? `id-${name}` : null }));
            return { data: entries.slice(offset, offset + limit), error: null };
          },
        };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, listed };
}

describe("listPropertyEvidencePaths", () => {
  it("finds every file under the listing, in every item folder", async () => {
    const { client } = fakeClient([
      "ag/p1/a3/1-agreement.pdf",
      "ag/p1/f3/2-building-pest.pdf",
      "ag/p1/x7/3-evidence.pdf",
      "ag/p1/x7/4-evidence-replaced.pdf",
      "ag/p2/a3/5-other-listing.pdf",
      "ag/_licences/u1/6-licence.pdf",
    ]);
    const paths = await listPropertyEvidencePaths(client, "ag", "p1");
    assert.deepEqual(paths.sort(), [
      "ag/p1/a3/1-agreement.pdf",
      "ag/p1/f3/2-building-pest.pdf",
      "ag/p1/x7/3-evidence.pdf",
      "ag/p1/x7/4-evidence-replaced.pdf",
    ]);
  });

  it("reads past the first page of a folder", async () => {
    const many = Array.from({ length: 230 }, (_, i) => `ag/p1/f3/${String(i).padStart(3, "0")}.pdf`);
    const { client } = fakeClient(many);
    const paths = await listPropertyEvidencePaths(client, "ag", "p1");
    assert.equal(paths.length, 230);
  });

  it("throws rather than call an unreadable folder empty", async () => {
    const { client } = fakeClient(["ag/p1/a3/1.pdf"], "ag/p1/a3");
    await assert.rejects(() => listPropertyEvidencePaths(client, "ag", "p1"), /could not list ag\/p1\/a3/);
  });
});

test("isInFolder: only a path inside the record's own folder", () => {
  const folder = listingFolder("ag", "p1");
  assert.equal(isInFolder("ag/p1/a1/1-voi.pdf", folder), true);
  assert.equal(isInFolder("ag/p2/b1/9-contract.pdf", folder), false);
  assert.equal(isInFolder("ag/p1", folder), false);
  assert.equal(isInFolder("ag/p10/a1/x.pdf", folder), false);
  assert.equal(isInFolder("ag/p1/../p2/b1/x.pdf", folder), false);
  assert.equal(isInFolder("ag/p1/a1/" + "x".repeat(1100), folder), false);
  assert.equal(isInFolder("ag/_cpd/me/1-cert.pdf", cpdFolder("ag", "me")), true);
  assert.equal(isInFolder("ag/_cpd/you/1-cert.pdf", cpdFolder("ag", "me")), false);
});

// property_items as cardFileRemovable reads it: select().eq().eq().
function cardsClient(rows: { agency_id: string; property_id: string; item_key: string; evidence_path: string }[]) {
  return {
    from: () => ({
      select: () => {
        const filters: Record<string, string> = {};
        const q = {
          eq(col: string, val: string) {
            filters[col] = val;
            return Object.keys(filters).length >= 2
              ? Promise.resolve({
                  data: rows.filter((r) => Object.entries(filters).every(([k, v]) => r[k as keyof typeof r] === v)),
                  error: null,
                })
              : q;
          },
        };
        return q;
      },
    }),
  } as unknown as SupabaseClient;
}

test("cardFileRemovable: the card's own file, named by no other card", async () => {
  const rows = [{ agency_id: "ag", property_id: "p1", item_key: "a1", evidence_path: "ag/p1/a1/1-voi.pdf" }];
  assert.equal(await cardFileRemovable(cardsClient(rows), { agencyId: "ag", propertyId: "p1", itemKey: "a1", path: "ag/p1/a1/1-voi.pdf" }), true);
});

test("cardFileRemovable: not another card's filed document on the same listing", async () => {
  const rows = [
    { agency_id: "ag", property_id: "p1", item_key: "b1", evidence_path: "ag/p1/b1/9-contract.pdf" },
    { agency_id: "ag", property_id: "p1", item_key: "a1", evidence_path: "ag/p1/b1/9-contract.pdf" },
  ];
  // Outside a1's folder, and b1 still names it.
  assert.equal(await cardFileRemovable(cardsClient(rows), { agencyId: "ag", propertyId: "p1", itemKey: "a1", path: "ag/p1/b1/9-contract.pdf" }), false);
});

test("cardFileRemovable: not a file in its own folder that another card also names", async () => {
  const rows = [
    { agency_id: "ag", property_id: "p1", item_key: "a4", evidence_path: "ag/p1/a4/2-esp.pdf" },
    { agency_id: "ag", property_id: "p1", item_key: "a4b", evidence_path: "ag/p1/a4/2-esp.pdf" },
  ];
  assert.equal(await cardFileRemovable(cardsClient(rows), { agencyId: "ag", propertyId: "p1", itemKey: "a4", path: "ag/p1/a4/2-esp.pdf" }), false);
});

// Upload limits (PR #20, migration 0056).
const MB = 1024 * 1024;
const f = (name: string, type: string, size = MB) => ({ name, type, size });

describe("evidenceFileProblem", () => {
  it("accepts every allowed type", () => {
    for (const file of [
      f("contract.pdf", "application/pdf"),
      f("photo.jpg", "image/jpeg"),
      f("photo.png", "image/png"),
      f("IMG_0001.HEIC", "image/heic"),
      f("notes.doc", "application/msword"),
      f("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      f("ledger.xls", "application/vnd.ms-excel"),
      f("ledger.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      f("offer.eml", "message/rfc822"),
      f("offer.msg", "application/vnd.ms-outlook"),
    ]) {
      assert.equal(evidenceFileProblem(file), null, file.name);
    }
  });

  it("accepts saved emails the browser gives an empty or generic type, and stores them under the right one", () => {
    assert.equal(evidenceFileProblem(f("Offer from buyer.msg", "")), null);
    assert.equal(evidenceFileProblem(f("Offer from buyer.msg", "application/octet-stream")), null);
    assert.equal(evidenceFileProblem(f("offer.EML", "")), null);
    assert.equal(evidenceContentType(f("Offer from buyer.msg", "")), "application/vnd.ms-outlook");
    assert.equal(evidenceContentType(f("offer.eml", "application/octet-stream")), "message/rfc822");
  });

  it("refuses other types with the plain message", () => {
    for (const file of [
      f("photos.zip", "application/zip"),
      f("setup.exe", "application/x-msdownload"),
      f("picture.webp", "image/webp"),
      f("no-extension", ""),
    ]) {
      assert.equal(evidenceFileProblem(file), WRONG_TYPE_MESSAGE, file.name);
    }
  });

  it("allows 150 MB and refuses anything over it", () => {
    assert.equal(MAX_EVIDENCE_BYTES, 150 * MB);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 140 * MB)), null);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 150 * MB)), null);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 160 * MB)), TOO_LARGE_MESSAGE);
  });
});
