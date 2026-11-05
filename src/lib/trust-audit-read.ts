// Reading a trust account audit report off an upload (Adam, 3 Nov 2026: "The
// office manager uploads the trust audit report and enters its details (or
// RealComply reads them from the report, as for other uploads). The licensee
// only confirms and signs"). Pure: no database, no model call. The reader is
// extractTrustAuditReport (lib/actions/extraction.ts); readTrustAuditReport
// (lib/actions/trust-account.ts) asks this what to show.
//
// Same rules as the licence and insurance readers (lib/licence-read.ts,
// lib/insurance-read.ts):
//
//   * A clear read fills in the auditor. Nothing is saved until Save, and
//     whoever saves can correct it first.
//   * A detail that can't be read with confidence is left as it was and asked
//     for. Never guessed.
//   * Not an audit report: nothing is filled in and the file is taken off.
//   * A report for a different year: the same, saying which year it is for.
//
// The date the report was received isn't on the report, so it is never read:
// the person who received it types it. The report's own date is said, to help.

export type TrustAuditReadRaw = {
  documentIs?: unknown;
  auditor?: unknown;
  periodEnd?: unknown;
  reportDate?: unknown;
  unreadableFields?: unknown;
};

export type TrustAuditRead =
  | { outcome: "wrong_document"; message: string }
  | { outcome: "wrong_period"; message: string; periodEnd: string }
  | {
      outcome: "read";
      /** Fill the Auditor field with this; null leaves it as it was. */
      auditor: string | null;
      /** The report's own date, to say; never saved as the date received. */
      reportDate: string | null;
      message: string;
    };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A real calendar date as YYYY-MM-DD, or null. */
export function realDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return value.trim();
}

const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Plain text, as printed: control characters out, spaces tidied, at most 120 characters. */
function plain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return text || null;
}

/**
 * What the read means for the audit for the year ended `periodEnd`
 * (YYYY-MM-DD), the year the form is for.
 */
export function trustAuditReadOutcome(raw: TrustAuditReadRaw | null | undefined, periodEnd: string): TrustAuditRead {
  const r = raw ?? {};
  if (r.documentIs !== "trust_account_audit_report") {
    return {
      outcome: "wrong_document",
      message:
        "This doesn't look like a trust account audit report, so it hasn't been attached. Check you chose the auditor's report and upload it again.",
    };
  }
  const unreadable = new Set(Array.isArray(r.unreadableFields) ? r.unreadableFields.filter((f) => typeof f === "string") : []);
  const readPeriod = unreadable.has("periodEnd") ? null : realDate(r.periodEnd);
  if (readPeriod && readPeriod !== periodEnd) {
    return {
      outcome: "wrong_period",
      periodEnd: readPeriod,
      message: `This report is for the year ended ${longDate(readPeriod)}, not ${longDate(periodEnd)}, so it hasn't been attached. Upload the report for the year ended ${longDate(periodEnd)}.`,
    };
  }
  const auditor = unreadable.has("auditor") ? null : plain(r.auditor);
  const reportDate = unreadable.has("reportDate") ? null : realDate(r.reportDate);
  const said: string[] = [];
  said.push(auditor ? "Auditor read from the report. Check it, then save." : "Couldn't read the auditor's name with confidence. Type it in.");
  if (!readPeriod) said.push(`Check the report covers the year ended ${longDate(periodEnd)}.`);
  if (reportDate) said.push(`The report is dated ${longDate(reportDate)}.`);
  return { outcome: "read", auditor, reportDate, message: said.join(" ") };
}
