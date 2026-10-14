import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACK_STATEMENT_TEXTS } from "@/lib/agent-acknowledgement";
import { fileAcknowledgementPdf } from "./agent-acknowledgement-file";

// The acknowledgement's PDF, filed in Document sign-offs once (job 7 brief,
// Part 2). A stand-in for the service client; the PDF builder is real.

type Row = Record<string, unknown>;

function fakeService(opts: { uploadFails?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    agent_acknowledgements: [
      {
        id: "ack1",
        agency_id: "ag1",
        profile_id: "p1",
        agent_licence_number: "20456789",
        agency_name: "Harbourline Property Group",
        licensee_name: "Jordan Ellis",
        licensee_licence_number: "10123456",
        wording_version: "1.0",
        wording: ACK_STATEMENT_TEXTS,
        typed_name: "Sam Taylor",
        confirmed_at: "2026-10-13T22:42:00Z",
        signoff_document_id: null,
      },
    ],
    agencies: [{ id: "ag1", logo_path: null }],
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
        upload: async (path: string, bytes: Uint8Array) =>
          opts.uploadFails ? { error: { message: "nope" } } : (uploads.push({ path, bytes }), { error: null }),
        download: async () => ({ data: null }),
      }),
    },
  };
  return { tables, uploads, client: client as unknown as SupabaseClient };
}

describe("fileAcknowledgementPdf", () => {
  it("files the PDF in Document sign-offs as the agent's own, and links it to the record", async () => {
    const s = fakeService();
    assert.deepEqual(await fileAcknowledgementPdf(s.client, "ack1"), { filed: true });

    assert.equal(s.uploads.length, 1);
    assert.equal(s.uploads[0].path, "ag1/_signoffs/agent-acknowledgement-v1.0-ack1.pdf");
    assert.equal(new TextDecoder().decode(s.uploads[0].bytes.slice(0, 5)), "%PDF-");

    const [doc] = s.tables.signoff_documents;
    assert.equal(doc.category, "agent_acknowledgement");
    assert.equal(doc.title, "Agent acknowledgement");
    assert.equal(doc.uploaded_by, "p1");
    assert.equal(doc.file_name, "Agent acknowledgement - Sam Taylor.pdf");
    assert.equal(s.tables.agent_acknowledgements[0].signoff_document_id, doc.id);
  });

  it("files it once: a second call leaves it alone", async () => {
    const s = fakeService();
    await fileAcknowledgementPdf(s.client, "ack1");
    assert.deepEqual(await fileAcknowledgementPdf(s.client, "ack1"), { filed: true });
    assert.equal(s.uploads.length, 1);
    assert.equal(s.tables.signoff_documents.length, 1);
  });

  it("never throws: a failed upload files nothing and says so", async () => {
    const s = fakeService({ uploadFails: true });
    assert.deepEqual(await fileAcknowledgementPdf(s.client, "ack1"), { filed: false });
    assert.equal(s.tables.signoff_documents.length, 0);
    assert.deepEqual(await fileAcknowledgementPdf(s.client, "no-such"), { filed: false });
  });
});
