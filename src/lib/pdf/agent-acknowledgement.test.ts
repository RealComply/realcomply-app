import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { ACK_STATEMENT_TEXTS } from "@/lib/agent-acknowledgement";
import { pdfText } from "@/lib/testing/pdf-text";
import { ACK_PDF_FOOTER, agentAcknowledgementFilename, buildAgentAcknowledgementPdf } from "./agent-acknowledgement";

// The agent acknowledgement's PDF (job 7 brief, Part 2): the record, the five
// boxes as shown, the office logo or the RealComply wordmark, and the footer.

const input = {
  agentName: "Sam Taylor",
  agentLicenceNumber: "20456789",
  agencyName: "Harbourline Property Group",
  licenseeName: "Jordan Ellis",
  licenseeLicenceNumber: "10123456",
  version: "1.0",
  statements: ACK_STATEMENT_TEXTS,
  confirmedAt: "2026-10-13T22:42:00Z",
  logo: null,
};

const flat = (s: string) => s.replace(/\s+/g, " ");

async function onePixelPng(): Promise<Uint8Array> {
  // The smallest valid PNG: 1x1, transparent.
  return Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
}

describe("buildAgentAcknowledgementPdf", () => {
  it("prints the record and the footer, with the RealComply wordmark when there is no logo", async () => {
    const text = flat(pdfText(await buildAgentAcknowledgementPdf(input)));
    for (const expected of [
      "Agent acknowledgement",
      "Sam Taylor",
      "20456789",
      "Harbourline Property Group",
      "Jordan Ellis",
      "10123456",
      "1.0",
      "Real",
      "Comply",
      ACK_PDF_FOOTER,
    ]) {
      assert.ok(text.includes(expected), `missing: ${expected}`);
    }
  });

  it("prints all five boxes as stored", async () => {
    const text = flat(pdfText(await buildAgentAcknowledgementPdf(input)));
    for (const s of ACK_STATEMENT_TEXTS) {
      // Every word, in order, wherever the lines break. Curly quotes print as
      // straight ones (lib/pdf/text.ts), as on every other PDF.
      const words = s.replace(/[\u201c\u201d]/g, '"').split(" ");
      let at = 0;
      for (const w of words) {
        const found = text.indexOf(w, at);
        assert.ok(found >= 0, `missing "${w}" of: ${s.slice(0, 40)}`);
        at = found + w.length;
      }
    }
  });

  it("takes the office's logo when it has one, and still builds if the logo is broken", async () => {
    const withLogo = await buildAgentAcknowledgementPdf({ ...input, logo: { bytes: await onePixelPng(), type: "png" } });
    const doc = await PDFDocument.load(withLogo);
    assert.ok(doc.getPageCount() >= 1);
    const broken = await buildAgentAcknowledgementPdf({ ...input, logo: { bytes: new Uint8Array([1, 2, 3]), type: "png" } });
    assert.ok(flat(pdfText(broken)).includes("Real"));
  });

  it("names the file after the agent, in plain characters", () => {
    assert.equal(agentAcknowledgementFilename("Sam Taylor"), "Agent acknowledgement - Sam Taylor.pdf");
    assert.equal(agentAcknowledgementFilename("Zoë O'Neil/2"), "Agent acknowledgement - Zoe O'Neil2.pdf");
  });
});
