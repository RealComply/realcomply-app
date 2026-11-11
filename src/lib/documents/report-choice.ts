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

// THE REPORT IN THE AGENCY AGREEMENT (Adam, 11 Nov 2026, decision 6: "Yes,
// counts as report"). When the agreement carries a page of comparable sales
// (a Realtair "Relevant Sales" page, a pricing annexure) and they were read
// from it, that page is the comparable sales report: nothing more needs
// uploading on the ESP card. Kept on the ESP card as data.reportInAgreement,
// for the agreement file it came from, and carried through Mark done.
export type ReportInAgreement = {
  /** The agreement file the sales were read from. Another file there now: not this one. */
  path: string;
  at: string;
  sales: number;
};

export function reportInAgreementOf(espData: unknown, agreementPath: string | null | undefined): ReportInAgreement | null {
  const r = (espData as { reportInAgreement?: ReportInAgreement } | null | undefined)?.reportInAgreement;
  if (!r || !agreementPath || r.path !== agreementPath || !(r.sales > 0)) return null;
  return r;
}

type CardRow = { data?: unknown; evidence_path?: string | null } | null | undefined;

/**
 * The listing needs its comparable sales report seen to: the report on the
 * ESP card gave no sales and isn't confirmed, or there's no report at all
 * once the agreement is on file and had none. Never while the agreement's
 * own sales page stands as the report.
 */
export function reportToCheck(esp: CardRow, agreement?: CardRow): boolean {
  if (reportInAgreementOf(esp?.data, agreement?.evidence_path)) return false;
  if (!esp?.evidence_path) return Boolean(agreement?.evidence_path);
  return noSalesInReport(esp.data, esp.evidence_path) && !confirmedAsReport(esp.data, esp.evidence_path);
}

/** The ESP card has a report: its own file, or the agreement's sales page. Needed to tick it (setItemStatus). */
export function hasReport(esp: CardRow, agreement?: CardRow): boolean {
  return Boolean(esp?.evidence_path) || reportInAgreementOf(esp?.data, agreement?.evidence_path) !== null;
}

/** Refused when the ESP card is ticked with no report from either. */
export const REPORT_NEEDED =
  "Add the comparable sales report before marking this done. If the sales are in the agency agreement, they're read from there.";

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

/** The ESP card, when its report is the agreement's sales page. */
export function inAgreementLine(r: ReportInAgreement): string {
  return `The comparable sales are in the agency agreement: ${r.sales} ${r.sales === 1 ? "sale" : "sales"} read from it. No separate report is needed.`;
}

/** What the ESP card says beside its report: asking, confirmed, the agreement's, or nothing extra. */
export type ReportPrompt =
  | { kind: "ask" }
  | { kind: "confirmed"; text: string }
  | { kind: "agreement"; text: string };

export function reportPromptFor(
  data: unknown,
  evidencePath: string | null | undefined,
  formatDate: (iso: string) => string,
  agreementPath?: string | null,
): ReportPrompt | null {
  // A file of its own with sales in it speaks for itself (the read's own line).
  if (evidencePath && !noSalesInReport(data, evidencePath)) return null;
  const inAgreement = reportInAgreementOf(data, agreementPath);
  if (inAgreement) return { kind: "agreement", text: inAgreementLine(inAgreement) };
  if (!evidencePath) return null;
  const confirmed = confirmedAsReport(data, evidencePath);
  return confirmed ? { kind: "confirmed", text: confirmedLine(confirmed, formatDate) } : { kind: "ask" };
}

/**
 * The compliance record's line when the report is the agreement's own sales
 * page and the ESP card has no report of its own; null otherwise.
 */
export function recordInAgreementLine(espData: unknown): string | null {
  const r = (espData as { reportInAgreement?: ReportInAgreement } | null | undefined)?.reportInAgreement;
  if (!r || !(r.sales > 0)) return null;
  return `Comparable sales report: the agency agreement's own sales page (${r.sales} ${r.sales === 1 ? "sale" : "sales"} read from it).`;
}
