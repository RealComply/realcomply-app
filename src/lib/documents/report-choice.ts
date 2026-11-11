// WHEN NO COMPARABLE SALES ARE FOUND IN THE REPORT (Master, from Adam's
// decisions, 11 Nov 2026).
//
// The ESP card's report was read to the end and no sales came out of it: the
// reader found none, or decided it was the agency agreement or the contract.
// The reader can be wrong, so the card stays ticked and nothing holds the
// stage. Instead the card says "We couldn't find comparable sales in this
// file. Upload your comparable sales report, or confirm this is it." with
// "Upload report" and "This is my report":
//
//   - Upload report: a new file goes on the card and is read in its turn.
//   - This is my report: the file stays, and the agent enters the sales by
//     hand on the ESP reasoning card, which shows what each sale is missing.
//
// Until one is done, the listing needs attention on the agent's Home and in
// the licensee's view (lib/property-digest reportToCheck). Which was chosen,
// by whom and when is kept on the ESP card as data.reportChoices, carried
// through Mark done (CARRIED_BY_ITEM in actions/compliance.ts). Adam's reader
// alert is unchanged.

import { reportReadOf } from "@/lib/documents/report-read";

export type ReportChoiceKind = "my_report" | "uploaded";

export type ReportChoice = {
  /** The file the prompt was about: for "uploaded", the file it replaced. */
  path: string;
  choice: ReportChoiceKind;
  by: string;
  byName: string;
  at: string;
};

/** Kept on the card; the newest last. A handful is plenty for one listing's report. */
const KEEP = 20;

export function reportChoicesOf(data: unknown): ReportChoice[] {
  const list = (data as { reportChoices?: unknown } | null | undefined)?.reportChoices;
  return Array.isArray(list) ? (list as ReportChoice[]).filter((c) => c && typeof c.path === "string") : [];
}

/** The report attached now was read to the end and gave no sales. */
export function noSalesInReport(data: unknown, evidencePath: string | null | undefined): boolean {
  const read = reportReadOf(data, evidencePath);
  return read?.outcome === "nothing_found" || read?.outcome === "wrong_document";
}

/** "This is my report", said about the file attached now. */
export function confirmedAsReport(data: unknown, evidencePath: string | null | undefined): ReportChoice | null {
  if (!evidencePath) return null;
  return reportChoicesOf(data).findLast((c) => c.path === evidencePath && c.choice === "my_report") ?? null;
}

/** The ESP card is asking the agent to upload their report or confirm this is it. */
export function reportToCheck(row: { data?: unknown; evidence_path?: string | null } | null | undefined): boolean {
  if (!row?.evidence_path) return false;
  return noSalesInReport(row.data, row.evidence_path) && !confirmedAsReport(row.data, row.evidence_path);
}

/** The card's data with one more choice recorded. */
export function withReportChoice(data: unknown, choice: ReportChoice): Record<string, unknown> {
  const base = { ...((data as Record<string, unknown> | null | undefined) ?? {}) };
  base.reportChoices = [...reportChoicesOf(data), choice].slice(-KEEP);
  return base;
}

/** The words on the badge, wherever the listing is said to need attention. */
export const REPORT_TO_CHECK_BADGE = "Comparable sales report to check";

/** The ESP card's prompt (Master, 11 Nov 2026). */
export const NO_SALES_PROMPT =
  "We couldn't find comparable sales in this file. Upload your comparable sales report, or confirm this is it.";
export const UPLOAD_REPORT = "Upload report";
export const THIS_IS_MY_REPORT = "This is my report";

/** After "This is my report": who said so and when, and what to do next. */
export function confirmedLine(choice: ReportChoice, formatDate: (iso: string) => string): string {
  return (
    `${choice.byName} confirmed this is the comparable sales report on ${formatDate(choice.at)}. ` +
    "Add its sales on the ESP reasoning card. Each sale shows any details still to fill in."
  );
}

/** What the ESP card says beside its report: asking, confirmed, or nothing extra. */
export type ReportPrompt = { kind: "ask" } | { kind: "confirmed"; text: string };

export function reportPromptFor(
  data: unknown,
  evidencePath: string | null | undefined,
  formatDate: (iso: string) => string,
): ReportPrompt | null {
  if (!evidencePath || !noSalesInReport(data, evidencePath)) return null;
  const confirmed = confirmedAsReport(data, evidencePath);
  return confirmed ? { kind: "confirmed", text: confirmedLine(confirmed, formatDate) } : { kind: "ask" };
}
