import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { SG_DOC_TYPES, type SgDocType } from "@/lib/sg-document/fair-trading";
import { amendmentRef, approvedBySaid, reasonSaid, whatChanged, type SgAmendment } from "@/lib/sg-document/amendments";

// The change log (Adam's mockup, screen 5) and the next review date
// (Fair Trading's Supervision Guidelines 2.1.2: operational procedures
// "should be reviewed and appropriately revised at least every 12 months").
// Every version saved and every amendment approved goes in the log, newest
// first, with when it starts, who approved it and how many staff have signed.
// "Reviewed, no changes needed" joins it in part 4.

/** A saved document: the one live now, or one it replaced. */
export type SgSavedVersion = {
  id: string;
  docType: SgDocType | null;
  versionLabel: string | null;
  savedAt: string;
  savedByName: string | null;
  /** Staff who have signed this version's file, of how many asked (0009). */
  signed: { signed: number; of: number } | null;
};

export type ChangeLogRow = {
  key: string;
  /** "3 Nov 2026" */
  starts: string;
  /** For sorting: YYYY-MM-DD. */
  startsIso: string;
  ref: string;
  document: string;
  whatChanged: string;
  reason: string;
  approvedBy: string;
  staffSigned: string;
};

/** "SG and procedures manual v7.3", as the log names a document. */
export function documentSaid(docType: SgDocType | null, versionLabel: string | null): string {
  const kind = docType === "sg_and_procedures" ? "SG and procedures manual" : docType ? SG_DOC_TYPES[docType] : "Supervision guidelines";
  return versionLabel ? `${kind} ${versionLabel}` : kind;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Nov 2026", the same on every machine (Intl says "Sept" on some). */
function short(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""} ${m[1]}`;
}

function ofSaid(s: { signed: number; of: number } | null): string {
  return s ? `${s.signed} of ${s.of}` : "Not recorded";
}

export function changeLogRows(
  versions: SgSavedVersion[],
  amendments: Array<{ amendment: SgAmendment; document: { docType: SgDocType | null; versionLabel: string | null }; signed: { signed: number; of: number } }>,
): ChangeLogRow[] {
  const ordered = [...versions].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const rows: ChangeLogRow[] = ordered.map((v, i) => {
    const iso = sydneyDate(new Date(v.savedAt));
    return {
      key: `version-${v.id}`,
      starts: short(iso),
      startsIso: iso,
      ref: v.versionLabel ?? "Version",
      document: documentSaid(v.docType, null),
      whatChanged: i === 0 ? "Uploaded to RealComply" : "New full version",
      reason: i === 0 ? "First upload" : "New version",
      approvedBy: v.savedByName ?? "A team member",
      staffSigned: ofSaid(v.signed),
    };
  });
  for (const { amendment: a, document, signed } of amendments) {
    if (a.status !== "approved") continue;
    rows.push({
      key: `amendment-${a.id}`,
      starts: short(a.startsOn),
      startsIso: a.startsOn,
      ref: amendmentRef(a),
      document: documentSaid(document.docType, document.versionLabel),
      whatChanged: whatChanged(a),
      reason: reasonSaid(a),
      approvedBy: approvedBySaid(a),
      staffSigned: ofSaid(signed),
    });
  }
  return rows.sort((x, y) => y.startsIso.localeCompare(x.startsIso) || y.key.localeCompare(x.key));
}

// ── The next review ──────────────────────────────────────────────────────

/** Twelve months after a day, the 28th for a 29 February. */
export function twelveMonthsAfter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const leap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  const day = m === 2 && d === 29 && !leap(y + 1) ? 28 : d;
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * When the next review is due (2.1.2: at least every 12 months; mockup note
 * 7: the first is 12 months after the office's RealComply sign-up date).
 * Every version saved and every amendment approved is a review: 12 months
 * after the latest of those and the sign-up.
 */
export function nextReviewDue(signedUpAt: string | null, reviewedAt: Array<string | null | undefined>): string | null {
  const days = [signedUpAt, ...reviewedAt]
    .filter((t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)))
    .map((t) => (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : sydneyDate(new Date(t))));
  if (days.length === 0) return null;
  return twelveMonthsAfter(days.sort().at(-1) as string);
}

/** "Next review due 14 August 2027". */
export function nextReviewSaid(due: string | null): string | null {
  return due ? `Next review due ${formatAuDate(due)}` : null;
}
