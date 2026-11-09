import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_TOOL, readListingDocument, type SourceKey } from "@/lib/documents/listing-reader";
import { councilAreaFrom } from "@/lib/rules/council-area";
import { councilAreaChange } from "@/lib/rules/council-area-form";

// The council area, off the planning certificate in the contract (Reg s12A;
// 0118). The reader here is a stand-in that answers what it's given; what is
// tested is ours: that the reader is asked for it, and that only the
// contract's answer keeps it.

type Answer = { documentIs: string; patches: Array<Record<string, unknown>> };

/** A reader that answers `answer`, and keeps what it was asked. */
function reader(answer: Answer) {
  const asked: string[] = [];
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    const content = params.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    for (const b of content) if (b.type === "text") asked.push(b.text);
    return {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_council", name: (params.tool_choice as { name: string }).name, input: answer }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
  return { asked, client: { messages: { create } } as unknown as Anthropic };
}

// Made up, and long enough to be read (a real document is never under 400 characters).
const TEXT =
  "CONTRACT FOR THE SALE AND PURCHASE OF LAND (made up). Vendor: Sam Seller (made up). Property: 12 Harbour " +
  "Street, Hornsby (made up). " +
  "PLANNING CERTIFICATE UNDER SECTION 10.7 OF THE ENVIRONMENTAL PLANNING AND ASSESSMENT ACT 1979. Issued by " +
  "Hornsby Shire Council (made up for this test). ".repeat(6);

async function readAs(source: SourceKey, answer: Answer) {
  const r = reader(answer);
  const blob = new Blob([TEXT], { type: "text/plain" });
  const patches = await readListingDocument({ anthropic: r.client, blob, fileName: "contract.txt", source, prescribedDocs: [] });
  return { patches, asked: r.asked.join("\n") };
}

describe("the council area from the contract's planning certificate", () => {
  it("is asked of the contract, and kept from its answer", async () => {
    const { patches, asked } = await readAs("b1", {
      documentIs: "contract_for_sale",
      patches: [{ itemKey: "b1", prescribedDocs: [], councilArea: "Hornsby Shire Council" }],
    });
    assert.match(asked, /set councilArea to the name of the council that issued it/);
    const b1 = patches.find((p) => p.itemKey === "b1");
    assert.equal(b1?.councilArea, "Hornsby Shire Council");
    assert.equal(councilAreaFrom(b1?.councilArea), "Hornsby");
    const schema = EXTRACTION_TOOL.input_schema as { properties: { patches: { items: { properties: Record<string, unknown> } } } };
    assert.ok(schema.properties.patches.items.properties.councilArea, "the reader's form has a place for it");
  });

  it("is never taken from the agency agreement or the comparables report", async () => {
    const agreement = await readAs("a3", {
      documentIs: "agency_agreement",
      patches: [{ itemKey: "a3", eventDate: "2026-11-01", councilArea: "Hornsby Shire Council" }],
    });
    assert.equal(agreement.patches.length, 1);
    assert.equal(agreement.patches[0].councilArea, undefined);
    assert.doesNotMatch(agreement.asked, /councilArea/, "only the contract is asked for it");

    const report = await readAs("a4", {
      documentIs: "comparable_sales",
      patches: [{ itemKey: "a4c", comparableSales: [], councilArea: "Hornsby Shire Council" }],
    });
    assert.equal(report.patches[0].councilArea, undefined);
  });

  it("is not kept off a document that isn't the contract", async () => {
    const { patches } = await readAs("b1", {
      documentIs: "agency_agreement",
      patches: [{ itemKey: "b1", councilArea: "Hornsby Shire Council" }],
    });
    assert.equal(patches.length, 1);
    assert.ok(patches[0].wrongDocument);
    assert.equal(patches[0].councilArea, undefined);
  });
});

describe("the council area as a form sends it", () => {
  it("writes only a change, as chosen by the agent", () => {
    assert.deepEqual(councilAreaChange("Hornsby", "Hornsby"), { update: null }, "unchanged: the certificate's stays");
    assert.deepEqual(councilAreaChange("", null), { update: null });
    assert.deepEqual(councilAreaChange("Uralla", null), { update: { council_area: "Uralla", council_area_from: "agent" } });
    assert.deepEqual(councilAreaChange("Ku-ring-gai", "Hornsby"), { update: { council_area: "Ku-ring-gai", council_area_from: "agent" } });
    assert.deepEqual(councilAreaChange("", "Hornsby"), { update: { council_area: null, council_area_from: null } }, "cleared");
  });

  it("refuses anything not on the list", () => {
    assert.deepEqual(councilAreaChange("Brisbane", null), { error: "Choose the council area from the list." });
    assert.deepEqual(councilAreaChange("hornsby shire council", null), { error: "Choose the council area from the list." });
  });
});
