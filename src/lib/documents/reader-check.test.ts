import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { readerCheckProblems, readerCheckSummary, runReaderCheck } from "@/lib/documents/reader-check";
import { DAILY_CHECK_SAMPLE, loadSampleCma } from "@/lib/documents/sample-cmas";
import { jobProblemEmail } from "@/lib/monitoring/check-in";

// The daily reader check (Adam, 1 Nov 2026): the real reader reads the
// made-up 27-sale report each morning, and Adam is emailed if the read fails
// or the number of sales isn't 27. Here the reader is a stand-in that answers
// the way the real one might go wrong.

type Answer = { documentIs: string; patches: Array<Record<string, unknown>> };
let correct: Answer;

before(async () => {
  correct = (await loadSampleCma(DAILY_CHECK_SAMPLE)).answer as Answer;
});

/** A reader that answers `answer`, stopping for `stop`, or throws `error`. */
function reader(answer: () => Answer, stop: "tool_use" | "max_tokens" = "tool_use", error?: Error) {
  const create = async (params: Anthropic.Messages.MessageCreateParamsNonStreaming) => {
    if (error) throw error;
    return {
      stop_reason: stop,
      content: [{ type: "tool_use", id: "toolu_check", name: (params.tool_choice as { name: string }).name, input: answer() }],
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  };
  return { messages: { create } } as unknown as Anthropic;
}

const dropSales = (n: number): Answer => ({
  ...correct,
  patches: correct.patches.map((p) =>
    Array.isArray(p.comparableSales) ? { ...p, comparableSales: (p.comparableSales as unknown[]).slice(n) } : p,
  ),
});

describe("the daily reader check", () => {
  it("passes when the reader finds all 27 sales: no problems, so no email", async () => {
    const result = await runReaderCheck({ anthropic: reader(() => correct) });
    assert.equal(result.ok, true);
    assert.equal(result.sales, 27);
    assert.deepEqual(readerCheckProblems(result), []);
    assert.match(readerCheckSummary(result), /^Passed: the reader found all 27 sales in long-report\.pdf \(3 listings\)/);
  });

  it("emails Adam when the reader finds a different number of sales", async () => {
    const result = await runReaderCheck({ anthropic: reader(() => dropSales(6)) });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["The reader found 21 sales in the sample report (long-report.pdf). It has 27."]);
    const email = jobProblemEmail("reader-check", result.problems, new Date("2026-11-01T19:15:00Z"));
    assert.equal(email.subject, "RealComply: the daily reader check had a problem");
    assert.match(email.text, /^The daily reader check ran at 2026-11-01T19:15:00.000Z \(UTC\) and had a problem:\n\n- The reader found 21 sales/);
  });

  it("emails Adam when the read fails: cut off at the limit, or the service down", async () => {
    const cut = await runReaderCheck({ anthropic: reader(() => dropSales(20), "max_tokens") });
    assert.equal(cut.ok, false);
    assert.equal(cut.failed, "cut_off");
    assert.deepEqual(cut.problems, [
      "The reader couldn't read the sample report (long-report.pdf): its answer hit the length limit and was cut off.",
    ]);
    const down = await runReaderCheck({ anthropic: reader(() => correct, "tool_use", new Error("socket hang up")) });
    assert.equal(down.ok, false);
    assert.equal(down.failed, "other");
  });

  it("emails Adam when the reader says the sample isn't a comparable-sales report", async () => {
    const result = await runReaderCheck({ anthropic: reader(() => ({ documentIs: "other", patches: [] })) });
    assert.equal(result.ok, false);
    assert.match(result.problems[0], /isn't a comparable-sales report, so it found no sales\. It has 27\./);
  });

  it("says so when there is no reader to check", async (t) => {
    t.mock.method(console, "error", () => {});
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await runReaderCheck();
      assert.equal(result.ok, false);
      assert.deepEqual(result.problems, ["ANTHROPIC_API_KEY is not set, so the reader couldn't be checked."]);
    } finally {
      if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    }
  });
});
