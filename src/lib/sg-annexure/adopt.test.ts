import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendEmailInput } from "@/lib/email/send";
import { pdfText } from "@/lib/testing/pdf-text";
import { adoptionRefusal, logoFor, saveSignedCopy } from "./adopt";

// After the database records an adoption (0067): the signed copy is made,
// filed in Document sign-offs for the licensee only, and emailed with a copy
// to admin@. Once.

type Row = Record<string, unknown>;

function fakeService() {
  const tables: Record<string, Row[]> = {
    sg_annexure_adoptions: [
      {
        id: "ad1",
        agency_id: "ag1",
        annexure_version: "1.4",
        signed_name: "Lee Licensee",
        licence_number: "10012345",
        sent_to: "getadamc3+licensee@gmail.com",
        signed_at: "2026-10-14T02:15:00Z",
        signoff_document_id: null,
      },
    ],
    agencies: [{ id: "ag1", name: "Harbour Realty", logo_path: null }],
    signoff_documents: [],
  };
  const uploads: Array<{ path: string; bytes: Uint8Array }> = [];
  const client = {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let patch: Row | null = null;
      let inserted: Row | null = null;
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const builder = {
        select: () => builder,
        insert: (row: Row) => {
          inserted = { id: `doc${(tables[table] ?? []).length + 1}`, ...row };
          (tables[table] ??= []).push(inserted);
          return builder;
        },
        update: (p: Row) => ((patch = p), builder),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: inserted, error: null }),
        then: (resolve: (v: unknown) => void) => {
          if (patch) for (const r of rows()) Object.assign(r, patch);
          resolve({ data: rows(), error: null });
        },
      };
      return builder;
    },
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array) => (uploads.push({ path, bytes }), { error: null }),
        download: async () => ({ data: null }),
      }),
    },
  };
  return { tables, uploads, client: client as unknown as SupabaseClient };
}

describe("the signed copy", () => {
  it("is filed in Document sign-offs for the licensee only, and emailed with a copy to admin@", async () => {
    const s = fakeService();
    const sent: SendEmailInput[] = [];
    const out = await saveSignedCopy(s.client, "ad1", { send: async (i) => (sent.push(i), true) });
    assert.deepEqual(out, { filed: true, emailed: true });

    assert.equal(s.uploads.length, 1);
    assert.equal(s.uploads[0].path, "ag1/_signoffs/sg-annexure-v1.4-ad1.pdf");
    const text = pdfText(s.uploads[0].bytes);
    assert.ok(text.includes("Name typed: Lee Licensee"));
    assert.ok(text.includes("Adoption request sent to: getadamc3+licensee@gmail.com"));

    const doc = s.tables.signoff_documents[0];
    assert.equal(doc.category, "sg_annexure");
    assert.equal(doc.signer_scope, "licensee_only");
    assert.equal(doc.uploaded_by, null, "nobody uploaded it, so nobody but the licensee can see it");
    assert.equal(doc.signed_file_path, "ag1/_signoffs/sg-annexure-v1.4-ad1.pdf");
    assert.equal(s.tables.sg_annexure_adoptions[0].signoff_document_id, doc.id);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "getadamc3+licensee@gmail.com");
    assert.equal(sent[0].bcc, "admin@realcomply.com.au");
    assert.equal(sent[0].attachments?.[0].contentType, "application/pdf");
    assert.equal(sent[0].attachments?.[0].filename, "SG annexure - Harbour Realty (signed).pdf");
  });

  it("is made once: an adoption already filed is left alone", async () => {
    const s = fakeService();
    const sent: SendEmailInput[] = [];
    await saveSignedCopy(s.client, "ad1", { send: async (i) => (sent.push(i), true) });
    const again = await saveSignedCopy(s.client, "ad1", { send: async (i) => (sent.push(i), true) });
    assert.deepEqual(again, { filed: true, emailed: false });
    assert.equal(s.tables.signoff_documents.length, 1);
    assert.equal(sent.length, 1);
  });
});

describe("the signed copy's Agency line (14 Oct 2026)", () => {
  it("prints the names as signed: X trading as Y", async () => {
    const s = fakeService();
    Object.assign(s.tables.sg_annexure_adoptions[0], { trading_name: "Harbour Realty", licensed_entity_name: "HR Holdings Pty Ltd" });
    // A later change in Office profile does not reach the signed copy.
    Object.assign(s.tables.agencies[0], { name: "Harbour Realty Group", licensed_entity_name: "Other Pty Ltd" });
    await saveSignedCopy(s.client, "ad1", { send: async () => true });
    const text = pdfText(s.uploads[0].bytes).replace(/\s+/g, " ");
    assert.ok(text.includes("HR Holdings Pty Ltd trading as Harbour Realty"), text.slice(0, 400));
    assert.ok(!text.includes("Other Pty Ltd"));
  });

  it("with no entity name, the trading name alone, as before", async () => {
    const s = fakeService();
    Object.assign(s.tables.sg_annexure_adoptions[0], { trading_name: "Harbour Realty", licensed_entity_name: null });
    await saveSignedCopy(s.client, "ad1", { send: async () => true });
    const text = pdfText(s.uploads[0].bytes).replace(/\s+/g, " ");
    assert.ok(text.includes("Harbour Realty"));
    assert.ok(!text.includes("trading as"));
  });
});

describe("what the signing page says when the database refuses", () => {
  it("passes on the database's own sentences", () => {
    for (const msg of ["Type your full name.", "Type your licence number.", "This link is no longer valid.", "This annexure has already been adopted."]) {
      assert.equal(adoptionRefusal({ code: "P0001", message: msg }), msg);
    }
  });

  it("reads a second adoption at the same moment as already adopted", () => {
    assert.equal(adoptionRefusal({ code: "23505", message: "duplicate key" }), "This annexure has already been adopted.");
  });

  it("says plainly when the subscription has ended, and nothing technical otherwise", () => {
    assert.match(adoptionRefusal({ message: "This agency's subscription has ended, so nothing can be added" }), /subscription has ended/);
    assert.equal(adoptionRefusal({ message: "permission denied for table x" }), "Something went wrong and nothing was signed. Try again in a minute.");
  });
});

describe("the logo, read with full rights (20 Oct 2026)", () => {
  // A storage client that records what it was asked to download.
  function storage() {
    const asked: string[] = [];
    const client = {
      storage: {
        from: () => ({
          download: async (path: string) => {
            asked.push(path);
            return { data: new Blob([new Uint8Array([137, 80, 78, 71])]), error: null };
          },
        }),
      },
    } as unknown as SupabaseClient;
    return { asked, client };
  }

  it("reads a logo in the office's own folder", async () => {
    const { asked, client } = storage();
    const logo = await logoFor(client, "ag1/_brand/1-logo.png", "ag1");
    assert.equal(logo?.type, "png");
    assert.deepEqual(asked, ["ag1/_brand/1-logo.png"]);
  });

  it("never reads one in another office's folder, or one climbing out with ..", async () => {
    for (const path of ["ag2/_brand/1-logo.png", "ag1/../ag2/_brand/1-logo.png"]) {
      const { asked, client } = storage();
      assert.equal(await logoFor(client, path, "ag1"), null, path);
      assert.deepEqual(asked, [], path);
    }
  });
});
