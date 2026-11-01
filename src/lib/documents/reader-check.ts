import Anthropic from "@anthropic-ai/sdk";
import { readListingDocument } from "@/lib/documents/listing-reader";
import { readFailureWhy, type ReadFailureWhy } from "@/lib/documents/read-core";
import { reportReadFrom } from "@/lib/documents/report-read";
import { DAILY_CHECK_SAMPLE, SAMPLE_CMAS, loadSampleCma } from "@/lib/documents/sample-cmas";

// THE DAILY READER CHECK (Adam, 1 Nov 2026). Early every morning, on live, the
// real reader reads one fixed made-up comparable-sales report (the long one,
// 27 sales: samples/cma/long-report.pdf) exactly as it reads an agent's. If
// the read fails, or the number of sales it finds isn't 27, Adam is emailed,
// and the check reports to Healthchecks like the other jobs (the "reader-check"
// check), so a check that didn't run at all is noticed too.
//
// What it catches that the tests on each pull request can't: the real
// reader's own behaviour. A model or service change that makes answers longer
// than the limit, or a reader that starts dropping sales, shows up here the
// next morning, on a report whose right answer is known, before an agent's
// listing does.
//
// Made-up data only, and it touches no office: nothing is saved, and the
// read is not in the record of reads (that is offices' reads).

export type ReaderCheckResult = {
  ok: boolean;
  sample: string;
  expectedSales: number;
  /** What the read found; null when it failed. */
  sales: number | null;
  listings: number | null;
  failed: ReadFailureWhy | null;
  seconds: number;
  /** Plain words, for Adam's email. Empty when it passed. */
  problems: string[];
};

const WHY_WORDS: Record<ReadFailureWhy, string> = {
  cut_off: "its answer hit the length limit and was cut off",
  unparseable: "its answer couldn't be used (not in the shape asked for)",
  refused: "it declined to answer",
  no_answer: "it gave no answer",
  too_large: "the file was too large for it",
  unsupported: "it couldn't take the file",
  file: "the sample file couldn't be opened",
  service: "the AI service returned an error (busy, overloaded or down)",
  other: "something else went wrong (Vercel's logs have the detail)",
};

/**
 * Reads the sample with the reader and says whether it found what is in it.
 * `anthropic` is the real reader unless a test passes a stand-in. Never throws.
 */
export async function runReaderCheck(
  options: { anthropic?: Anthropic; now?: () => number } = {},
): Promise<ReaderCheckResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const sample = SAMPLE_CMAS.find((s) => s.name === DAILY_CHECK_SAMPLE)!;
  const base = { sample: `${sample.name}.pdf`, expectedSales: sample.sales };
  const seconds = () => Math.round((now() - started) / 100) / 10;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!options.anthropic && !key) {
    return {
      ...base, ok: false, sales: null, listings: null, failed: "other", seconds: seconds(),
      problems: ["ANTHROPIC_API_KEY is not set, so the reader couldn't be checked."],
    };
  }
  const anthropic = options.anthropic ?? new Anthropic({ apiKey: key });

  try {
    const file = await loadSampleCma(sample.name);
    const blob = new Blob([Buffer.from(file.bytes)], { type: "application/pdf" });
    const patches = await readListingDocument({ anthropic, blob, fileName: base.sample, source: "a4", prescribedDocs: [] });
    const read = reportReadFrom(patches, `samples/cma/${base.sample}`, new Date(started).toISOString());
    const sales = read.sales ?? 0;
    const listings = read.listings ?? 0;
    const problems =
      read.outcome === "wrong_document"
        ? [`The reader said the sample report (${base.sample}) isn't a comparable-sales report, so it found no sales. It has ${sample.sales}.`]
        : sales !== sample.sales
          ? [`The reader found ${sales} sale${sales === 1 ? "" : "s"} in the sample report (${base.sample}). It has ${sample.sales}.`]
          : [];
    return { ...base, ok: problems.length === 0, sales, listings, failed: null, seconds: seconds(), problems };
  } catch (err) {
    const why = readFailureWhy(err);
    console.error(`document read failed: reader_check (${why})`, err instanceof Anthropic.APIError ? err.status : "");
    return {
      ...base, ok: false, sales: null, listings: null, failed: why, seconds: seconds(),
      problems: [`The reader couldn't read the sample report (${base.sample}): ${WHY_WORDS[why]}.`],
    };
  }
}

/** For the job's check-in and Adam's email (lib/monitoring/check-in monitoredJob). */
export function readerCheckProblems(result: ReaderCheckResult): string[] {
  return result.problems;
}

/** One line for the logs and the staff page: what the check found. */
export function readerCheckSummary(result: ReaderCheckResult): string {
  return result.ok
    ? `Passed: the reader found all ${result.expectedSales} sales in ${result.sample} (${result.listings} listings), in ${result.seconds} seconds.`
    : `Problem: ${result.problems.join(" ")}`;
}
