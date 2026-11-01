import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { LISTING_READER_MAX_TOKENS, readListingDocument } from "@/lib/documents/listing-reader";
import { reportReadFrom } from "@/lib/documents/report-read";
import { UnfinishedAnswer } from "@/lib/documents/reader-answer";
import { SAMPLE_CMAS, loadSampleCma, type SampleCmaFile, type SampleCmaName } from "@/lib/documents/sample-cmas";

// The made-up comparable-sales reports, read on every pull request (Adam,
// 1 Nov 2026): a long report with 27 sales, a scanned one, a CoreLogic-style
// and a Pricefinder-style report. Each must come back with the right number
// of sales. On 30 Oct a real report's answer was cut off at the reader's
// length limit (1,536 tokens) and passed for "no sales found"; these fail if
// the limit goes back there.
//
// THE READER HERE IS A STAND-IN, because a pull request has no key for the
// real one. It answers each sample with what a correct read of it gives
// (samples/cma/<name>.json, made with the PDF from the same data), and it
// honours the limit it is asked with the way the real one does: an answer
// longer than the limit comes back cut off, holding only what fitted, which
// looks exactly like a shorter report. So what is tested is everything of
// ours around the real reader: the limit we ask with, that a cut-off answer
// is a failed read and never a shorter list, how each answer is checked,
// sorted and counted, and that each PDF (the scanned one included) gets to the
// reader at all.
//
// The real reader reads the long report every morning on live (the reader
// check, lib/documents/reader-check). With READER_LIVE_TESTS=1 and an
// ANTHROPIC_API_KEY these same tests use the real reader too.

const LIVE = process.env.READER_LIVE_TESTS === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

/** About three characters to a token, for an answer like these: addresses, numbers, short keys. */
export function estimateTokens(input: unknown): number {
  return Math.ceil(JSON.stringify(input).length / 3);
}

const hash = (base64: string) => createHash("sha256").update(base64).digest("hex");

type Answer = { documentIs: string; patches: Array<Record<string, unknown>> };

/** The answer cut off at `limit`: the sales that fitted, nothing after them. */
function cutOff(answer: Answer, limit: number): Answer {
  const withSales = (n: number): Answer => ({
    documentIs: answer.documentIs,
    patches: answer.patches.map((p) => {
      if (!Array.isArray(p.comparableSales)) return p;
      // The sales come first in the answer; what comes after them never arrives.
      const rest = { ...p };
      delete rest.marketListings;
      delete rest.subjectProperty;
      return { ...rest, comparableSales: (p.comparableSales as unknown[]).slice(0, n) };
    }),
  });
  let n = 0;
  while (estimateTokens(withSales(n + 1)) <= limit) n++;
  return withSales(n);
}

/** A stand-in for the reader that knows the samples. `cap` stands for a lower limit in the app. */
function standInReader(samples: Map<string, Answer>, { cap = Infinity }: { cap?: number } = {}) {
  const askedWith: number[] = [];
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    askedWith.push(params.max_tokens);
    const limit = Math.min(params.max_tokens, cap);
    const content = params.messages[0].content as Anthropic.Messages.ContentBlockParam[];
    const file = content.find((b) => b.type === "document") as { source: { data: string } } | undefined;
    const answer = file && samples.get(hash(file.source.data));
    if (!answer) throw new Error("The stand-in reader was shown a file that isn't one of the samples.");
    const tool = (params.tool_choice as { name: string }).name;
    const tokens = estimateTokens(answer);
    const finished = tokens <= limit;
    return {
      id: "msg_sample",
      type: "message",
      role: "assistant",
      model: params.model,
      stop_reason: finished ? "tool_use" : "max_tokens",
      stop_sequence: null,
      content: [{ type: "tool_use", id: "toolu_sample", name: tool, input: finished ? answer : cutOff(answer, limit) }],
      usage: { input_tokens: 0, output_tokens: Math.min(tokens, limit) },
    };
  };
  return { askedWith, client: { messages: { create } } as unknown as Anthropic };
}

const loaded = new Map<SampleCmaName, SampleCmaFile>();
const byHash = new Map<string, Answer>();

before(async () => {
  for (const sample of SAMPLE_CMAS) {
    const file = await loadSampleCma(sample.name);
    loaded.set(sample.name, file);
    byHash.set(hash(Buffer.from(file.bytes).toString("base64")), file.answer as Answer);
  }
});

async function read(name: SampleCmaName, anthropic: Anthropic) {
  const file = loaded.get(name)!;
  const blob = new Blob([Buffer.from(file.bytes)], { type: "application/pdf" });
  const patches = await readListingDocument({ anthropic, blob, fileName: `${name}.pdf`, source: "a4", prescribedDocs: [] });
  return reportReadFrom(patches, `samples/cma/${name}.pdf`, "2026-11-01T00:00:00Z");
}

describe("the sample comparable-sales reports", () => {
  it("are four, made up, and each record matches its count", async () => {
    assert.deepEqual(
      SAMPLE_CMAS.map((s) => [s.name, s.sales]),
      [["long-report", 27], ["scanned-report", 9], ["corelogic-style", 12], ["pricefinder-style", 10]],
    );
    for (const sample of SAMPLE_CMAS) {
      const file = loaded.get(sample.name)!;
      assert.equal(file.sales, sample.sales, sample.name);
      assert.equal(file.listings, sample.listings, sample.name);
      const answer = file.answer as Answer;
      const sales = answer.patches.reduce((n, p) => n + ((p.comparableSales as unknown[] | undefined)?.length ?? 0), 0);
      assert.equal(sales, sample.sales, `${sample.name}: the recorded answer holds every sale`);
      const pdf = await PDFDocument.load(file.bytes, { updateMetadata: false });
      assert.match(pdf.getSubject() ?? "", /^MADE-UP SAMPLE FOR TESTING/, `${sample.name} says it is made up`);
    }
  });

  it("include a scanned report with no text in it at all, only pictures of pages", () => {
    const pdf = Buffer.from(loaded.get("scanned-report")!.bytes).toString("latin1");
    assert.ok(!pdf.includes("/Font"), "no fonts, so no text");
    assert.ok(pdf.includes("/Image"), "pictures of the pages");
  });
});

describe(`reading them${LIVE ? " with the real reader" : ""}`, () => {
  for (const sample of SAMPLE_CMAS) {
    it(`${sample.name} (${sample.about}): ${sample.sales} sales`, { timeout: LIVE ? 240_000 : 10_000 }, async () => {
      const reader = LIVE ? null : standInReader(byHash);
      const anthropic = reader?.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await read(sample.name, anthropic);
      assert.equal(result.outcome, "read");
      assert.equal(result.sales, sample.sales, "every sale in the report");
      assert.equal(result.listings, sample.listings, "every listing on the market");
      if (reader) assert.deepEqual(reader.askedWith, [LISTING_READER_MAX_TOKENS], "asked once, with the reader's own limit");
    });
  }

  it("leave room: the longest answer fits the limit twice over", { skip: LIVE }, () => {
    for (const sample of SAMPLE_CMAS) {
      const tokens = estimateTokens(loaded.get(sample.name)!.answer);
      assert.ok(tokens * 2 <= LISTING_READER_MAX_TOKENS, `${sample.name} needs about ${tokens} tokens`);
    }
  });
});

describe("the limit of 30 October (1,536 tokens)", { skip: LIVE }, () => {
  it("would cut off the long report's answer, and that is a failed read, never a shorter list", async () => {
    assert.ok(estimateTokens(loaded.get("long-report")!.answer) > 1536, "27 sales don't fit in 1,536");
    const reader = standInReader(byHash, { cap: 1536 });
    await assert.rejects(read("long-report", reader.client), (e: unknown) => e instanceof UnfinishedAnswer && e.why === "cut_off");
  });

  it("is not where the reader's limit is", () => {
    assert.ok(LISTING_READER_MAX_TOKENS >= 8000, `the limit is ${LISTING_READER_MAX_TOKENS}`);
  });
});
