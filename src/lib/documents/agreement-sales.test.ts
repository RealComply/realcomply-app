import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { AGREEMENT_SALES_PROMPT, readListingDocument, type SourceKey } from "@/lib/documents/listing-reader";
import {
  REPORT_NEEDED,
  hasReport,
  recordInAgreementLine,
  reportInAgreementOf,
  reportPromptFor,
  reportToCheck,
} from "@/lib/documents/report-choice";
import { computePropertyDigests } from "@/lib/property-digest";
import type { Property, PropertyItem } from "@/lib/types";

// The agency agreement's own sales page stands as the comparable sales report
// (Adam, 11 Nov 2026, decision 6: "Yes, counts as report"). The reader here
// is a stand-in that answers what it's given; what is tested is ours.

type Answer = { documentIs: string; patches: Array<Record<string, unknown>> };

function reader(answer: Answer) {
  const asked: string[] = [];
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    const content = params.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    for (const b of content) if (b.type === "text") asked.push(b.text);
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_agreement", name: (params.tool_choice as { name: string }).name, input: answer }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
  return { asked, client: { messages: { create } } as unknown as Anthropic };
}

// Made up, and long enough to be read.
const TEXT =
  "SALES INSPECTION REPORT AND EXCLUSIVE AGENCY AGREEMENT (made up). Property: 8 Smith Street, Testville. " +
  "Agency Agreement Pricing Annexure. Relevant Sales: 10 Jones Road, Testville, $1,200,000, 1/10/2026; " +
  "4 Brown Avenue, Testville, $1,150,000, 12/9/2026. ".repeat(4);

async function readAs(source: SourceKey, answer: Answer) {
  const r = reader(answer);
  const blob = new Blob([TEXT], { type: "text/plain" });
  const patches = await readListingDocument({ anthropic: r.client, blob, fileName: "agreement.txt", source, prescribedDocs: [] });
  return { patches, asked: r.asked.join("\n") };
}

const SALES = [
  { address: "10 Jones Road, Testville (made up)", salePrice: 1200000, saleDate: "2026-10-01" },
  { address: "4 Brown Avenue, Testville (made up)", salePrice: 1150000, saleDate: "2026-09-12" },
];

describe("the agency agreement's own sales page", () => {
  it("is asked for, and its sales are kept off the agreement; its listings and the subject's details aren't", async () => {
    const { patches, asked } = await readAs("a3", {
      documentIs: "agency_agreement",
      patches: [
        { itemKey: "a4c", comparableSales: SALES, marketListings: [{ address: "1 For Sale St (made up)" }], subjectProperty: { bedrooms: 3 } },
      ],
    });
    assert.ok(asked.includes(AGREEMENT_SALES_PROMPT), "the agreement is asked for its sales page");
    const a4c = patches.find((p) => p.itemKey === "a4c")!;
    assert.equal(a4c.comparableSales?.length, 2);
    assert.equal(a4c.marketListings, undefined);
    assert.equal(a4c.subjectProperty, undefined);
  });

  it("the contract still gives no sales", async () => {
    const { patches } = await readAs("b1", { documentIs: "contract_for_sale", patches: [{ itemKey: "a4c", comparableSales: SALES }] });
    assert.equal(patches.find((p) => p.itemKey === "a4c")?.comparableSales, undefined);
  });
});

const AGREEMENT = "agency/listing/a3/agreement.pdf";
const REPORT = "agency/listing/a4/report.pdf";
const inAgreement = (path = AGREEMENT, sales = 3) => ({ reportInAgreement: { path, at: "2026-11-11T00:02:30Z", sales } });

describe("the sales page stands as the report", () => {
  it("only for the agreement on file now, and only with sales in it", () => {
    assert.equal(reportInAgreementOf(inAgreement(), AGREEMENT)?.sales, 3);
    assert.equal(reportInAgreementOf(inAgreement("agency/listing/a3/older.pdf"), AGREEMENT), null);
    assert.equal(reportInAgreementOf(inAgreement(AGREEMENT, 0), AGREEMENT), null);
  });

  it("no report needed on the ESP card, and nothing to check", () => {
    const esp = { data: inAgreement(), evidence_path: null };
    const agreement = { evidence_path: AGREEMENT };
    assert.equal(hasReport(esp, agreement), true);
    assert.equal(reportToCheck(esp, agreement), false);
    assert.deepEqual(reportPromptFor(esp.data, null, (d) => d, AGREEMENT), {
      kind: "agreement",
      text: "The comparable sales are in the agency agreement: 3 sales read from it. No separate report is needed.",
    });
  });

  it("a report on the ESP card that found no sales isn't asked about while the agreement's page stands", () => {
    const esp = { data: { ...inAgreement(), reportRead: { at: "t", path: REPORT, outcome: "nothing_found" } }, evidence_path: REPORT };
    assert.equal(reportToCheck(esp, { evidence_path: AGREEMENT }), false);
    assert.equal(reportPromptFor(esp.data, REPORT, (d) => d, AGREEMENT)?.kind, "agreement");
  });

  it("no report anywhere: needs attention once the agreement is on file, and the ESP card can't be ticked", () => {
    const esp = { data: {}, evidence_path: null };
    assert.equal(reportToCheck(esp, { evidence_path: AGREEMENT }), true);
    assert.equal(reportToCheck(esp, { evidence_path: null }), false, "nothing to say before the agreement is on file");
    assert.equal(hasReport(esp, { evidence_path: AGREEMENT }), false);
    assert.match(REPORT_NEEDED, /^Add the comparable sales report before marking this done\./);
  });

  it("the record says where the report is", () => {
    assert.equal(recordInAgreementLine(inAgreement()), "Comparable sales report: the agency agreement's own sales page (3 sales read from it).");
    assert.equal(recordInAgreementLine({}), null);
  });

  it("the listing needs no attention in the digest when the agreement's page stands", () => {
    const property = { id: "p1", address: "8 Smith Street, Testville (made up)", stage: 1, created_by: "u1", test_mode: false } as unknown as Property;
    const row = (item_key: string, over: Record<string, unknown>) =>
      ({ property_id: "p1", item_key, status: "open", data: {}, evidence_path: null, recorded_at: "2026-11-11T00:00:00Z", ...over }) as unknown as PropertyItem;
    const a3 = row("a3", { evidence_path: AGREEMENT });
    const withPage = computePropertyDigests([property], new Map([["p1", new Map([["a3", a3], ["a4", row("a4", { data: inAgreement() })]])]]));
    assert.equal(withPage[0].reportToCheck, false);
    const without = computePropertyDigests([property], new Map([["p1", new Map([["a3", a3]])]]));
    assert.equal(without[0].reportToCheck, true);
  });
});
