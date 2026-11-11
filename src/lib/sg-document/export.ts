import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { SG_DOC_TYPES, type SgDocType } from "@/lib/sg-document/fair-trading";
import { sectionHeading } from "@/lib/sg-document/sections";
import { amendmentLine, amendmentRef, withAmendments, type SgAmendment } from "@/lib/sg-document/amendments";
import { nextReviewSaid, type ChangeLogRow } from "@/lib/sg-document/change-log";
import { pdfTitle, type SgPdfInput } from "@/lib/pdf/sg-document";

// Export PDF (Adam's mockup, screens 2 and 5; part 4b): what goes in it, in
// words, from the live document, its approved amendments and the change log.
// Pure, so it's tested; lib/pdf/sg-document.ts draws it.

type Section = { position: number; number: string | null; title: string; paragraphs: string[] };

/** "v7.3", "Version 3", as the live document's heading says it. */
export function versionSaid(versionLabel: string | null): string | null {
  const v = versionLabel?.trim();
  if (!v) return null;
  return /^v/i.test(v) ? v : `Version ${v}`;
}

export function sgPdfInput(i: {
  officeName: string;
  docType: SgDocType | null;
  versionLabel: string | null;
  savedAt: string | null;
  savedByName: string | null;
  sections: Section[];
  amendments: SgAmendment[];
  nextReviewDue: string | null;
  exportedBy: string;
  /** Today in Sydney, YYYY-MM-DD. */
  today: string;
  changeLog: ChangeLogRow[];
}): SgPdfInput {
  const approved = i.amendments.filter((a) => a.status === "approved" && a.refNo !== null);
  const details = [
    approved.length > 0 ? `${approved.length} ${approved.length === 1 ? "amendment" : "amendments"} merged in` : null,
    nextReviewSaid(i.nextReviewDue),
  ].filter((d): d is string => Boolean(d));
  return {
    officeName: i.officeName.trim() || "Your office",
    title: i.docType ? SG_DOC_TYPES[i.docType] : "Supervision guidelines",
    versionSaid: versionSaid(i.versionLabel),
    details,
    savedLine: i.savedAt
      ? `Saved to RealComply ${formatAuDate(sydneyDate(new Date(i.savedAt)))}${i.savedByName ? ` by ${i.savedByName}` : ""}.`
      : null,
    exportedLine: `Exported ${formatAuDate(i.today)} by ${i.exportedBy}.`,
    sections: withAmendments(i.sections, approved).map((s) => ({
      heading: sectionHeading(s),
      paragraphs: s.live.map((p) => ({
        text: p.text,
        amendedLine: p.amendment ? `Amended ${amendmentRef(p.amendment)} · ${amendmentLine(p.amendment)}` : null,
      })),
    })),
    changeLog: i.changeLog,
  };
}

/** "Supervision guidelines and procedures manual v7.3.pdf": plain, safe in a download. */
export function sgPdfFileName(input: Pick<SgPdfInput, "title" | "versionSaid">): string {
  const name = pdfTitle(input)
    .normalize("NFD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${name || "Supervision guidelines"}.pdf`;
}
