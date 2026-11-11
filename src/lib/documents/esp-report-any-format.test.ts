import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { readListingDocument, type SourceKey } from "@/lib/documents/listing-reader";
import { reportReadFrom } from "@/lib/documents/report-read";

// The ESP card reads any format for sales (Adam, 11 Nov 2026): an agent's own
// appraisal, a letter, a few pages cut from a bigger report. It is the wrong
// file only when it is plainly the agreement or the contract with no sales in
// it. The agreement and the contract keep their check. The reader here is a
// stand-in that answers what it's given; what is tested is ours.

type Answer = { documentIs: string; patches: Array<Record<string, unknown>> };

function reader(answer: Answer) {
  const asked: string[] = [];
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    const content = params.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    for (const b of content) if (b.type === "text") asked.push(b.text);
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_esp", name: (params.tool_choice as { name: string }).name, input: answer }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
  return { asked, client: { messages: { create } } as unknown as Anthropic };
}

// Made up, and long enough to be read.
const TEXT =
  "MARKET APPRAISAL for 8 Smith Street, Testville (made up). Dear Sam Seller (made up), thank you for inviting us " +
  "to appraise your home. Recent sales nearby: 10 Jones Road, Testville, sold $1,200,000 on 1 October 2026; " +
  "4 Brown Avenue, Testville, sold $1,150,000 on 12 September 2026. ".repeat(4);

async function readAs(source: SourceKey, answer: Answer) {
  const r = reader(answer);
  const blob = new Blob([TEXT], { type: "text/plain" });
  const patches = await readListingDocument({ anthropic: r.client, blob, fileName: "appraisal.txt", source, prescribedDocs: [] });
  return { patches, asked: r.asked.join("\n") };
}

const SALES = [
  { address: "10 Jones Road, Testville (made up)", salePrice: 1200000, saleDate: "2026-10-01" },
  { address: "4 Brown Avenue, Testville (made up)", salePrice: 1150000, saleDate: "2026-09-12" },
];

describe("the ESP card reads any format for sales", () => {
  it("an agent's own appraisal the reader calls 'other' is read for its sales", async () => {
    const { patches, asked } = await readAs("a4", { documentIs: "other", patches: [{ itemKey: "a4c", comparableSales: SALES }] });
    assert.deepEqual(patches.map((p) => p.itemKey), ["a4c"]);
    assert.equal(patches[0].comparableSales?.length, 2);
    assert.equal(patches[0].wrongDocument, undefined);
    assert.equal(reportReadFrom(patches, "p", "t").outcome, "read");
    assert.match(asked, /whatever its format, call record_findings/);
    assert.doesNotMatch(asked, /only if it really is/);
  });

  it("a file with no sales in it is 'no sales found', not the wrong file", async () => {
    const { patches } = await readAs("a4", { documentIs: "other", patches: [] });
    assert.deepEqual(patches, []);
    assert.equal(reportReadFrom(patches, "p", "t").outcome, "nothing_found");
  });

  it("the agency agreement or the contract with no sales in it is the wrong file", async () => {
    for (const [kind, words] of [
      ["agency_agreement", "an agency agreement"],
      ["contract_for_sale", "a contract for sale of land"],
    ] as const) {
      const { patches } = await readAs("a4", { documentIs: kind, patches: [] });
      assert.deepEqual(patches, [{ itemKey: "a4", wrongDocument: { expected: "a comparable-sales report", actual: words } }]);
      assert.equal(reportReadFrom(patches, "p", "t").outcome, "wrong_document");
    }
  });

  it("an agreement with the comparable sales attached is read for them", async () => {
    const { patches } = await readAs("a4", { documentIs: "agency_agreement", patches: [{ itemKey: "a4c", comparableSales: SALES }] });
    assert.equal(patches[0].comparableSales?.length, 2);
    assert.equal(reportReadFrom(patches, "p", "t").outcome, "read");
  });

  it("the contract and the agreement keep their check: the wrong document gives nothing", async () => {
    const contract = await readAs("b1", { documentIs: "other", patches: [{ itemKey: "b1", prescribedDocs: [] }] });
    assert.equal(contract.patches.length, 1);
    assert.ok(contract.patches[0].wrongDocument);
    assert.match(contract.asked, /only if it really is the contract/);
    const agreement = await readAs("a3", { documentIs: "comparable_sales", patches: [{ itemKey: "a3", note: "x" }] });
    assert.ok(agreement.patches[0].wrongDocument);
  });
});
