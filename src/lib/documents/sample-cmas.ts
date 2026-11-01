import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The made-up comparable-sales reports (CMAs) the reader is tested on (Adam,
// 1 Nov 2026), kept in samples/cma/ with the answer a correct read gives.
// Made by scripts/samples/make-sample-cmas.mjs: every office, agent, address
// and figure is invented, and every page says so.
//
// Read on every pull request by src/lib/documents/sample-cmas.test.ts, and
// once a day on live by the reader check (lib/documents/reader-check), which
// reads DAILY_CHECK_SAMPLE with the real reader.

export const SAMPLE_CMAS = [
  { name: "long-report", sales: 27, listings: 3, about: "an agency's own CMA, 27 sales over four pages" },
  { name: "scanned-report", sales: 9, listings: 0, about: "a typed appraisal printed and scanned: pictures of pages, no text in the file" },
  { name: "corelogic-style", sales: 12, listings: 4, about: "property cards, laid out the way the big data provider's CMA is" },
  { name: "pricefinder-style", sales: 10, listings: 3, about: "a sales evidence table, laid out the way the other big provider's report is" },
] as const;

export type SampleCma = (typeof SAMPLE_CMAS)[number];
export type SampleCmaName = SampleCma["name"];

/** The one the daily check on live reads: the longest, the kind cut off on 30 Oct 2026. */
export const DAILY_CHECK_SAMPLE: SampleCmaName = "long-report";

/**
 * Where the samples are. The project root, which is also where a deployed
 * function runs from: next.config.ts bundles the daily check's sample with
 * its route (outputFileTracingIncludes).
 */
export function sampleCmaPath(name: SampleCmaName, extension: "pdf" | "json"): string {
  return join(process.cwd(), "samples", "cma", `${name}.${extension}`);
}

export type SampleCmaFile = {
  bytes: Uint8Array;
  /** What a correct read takes from it: the reader's answer, as recorded. */
  answer: Record<string, unknown>;
  sales: number;
  listings: number;
};

export async function loadSampleCma(name: SampleCmaName): Promise<SampleCmaFile> {
  const [bytes, json] = await Promise.all([readFile(sampleCmaPath(name, "pdf")), readFile(sampleCmaPath(name, "json"), "utf-8")]);
  const record = JSON.parse(json) as { sales: number; listings: number; answer: Record<string, unknown> };
  return { bytes: new Uint8Array(bytes), answer: record.answer, sales: record.sales, listings: record.listings };
}
