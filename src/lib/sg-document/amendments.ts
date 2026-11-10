import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";

// Supervision guidelines, part 2 (Adam's mockup, signed off 6 Nov 2026,
// screens 3, 5 and 6; 0125). A quick amendment changes one paragraph of the
// live document, or adds one at the end of a section. Approved, it is
// numbered A1, A2 ..., shows in place, highlighted, with the previous wording
// kept, goes in the change log, and every staff member signs it: "I've read
// and understood this change".

export const SG_AMENDMENT_REASONS = {
  law_change: "Law change",
  audit_finding: "Audit finding",
  complaint: "Complaint",
  staffing: "Staffing",
  other: "Other",
} as const;
export type SgAmendmentReason = keyof typeof SG_AMENDMENT_REASONS;

export function isSgAmendmentReason(v: unknown): v is SgAmendmentReason {
  return typeof v === "string" && v in SG_AMENDMENT_REASONS;
}

export type SgAmendment = {
  id: string;
  documentId: string;
  refNo: number | null;
  sectionPosition: number;
  paragraphIndex: number;
  sectionLabel: string;
  previousText: string;
  newText: string;
  reason: SgAmendmentReason;
  reasonOther: string | null;
  startsOn: string;
  status: "draft" | "approved";
  createdByName: string | null;
  createdAt: string;
  approvedByName: string | null;
  approvedAs: "licensee" | "office_manager" | null;
  approvedAt: string | null;
};

/** One row of sg_amendments, as read back. Null for anything that isn't one. */
export function amendmentFrom(row: Record<string, unknown>): SgAmendment | null {
  const status = row.status === "approved" || row.status === "draft" ? row.status : null;
  if (!status || typeof row.id !== "string" || typeof row.new_text !== "string" || !isSgAmendmentReason(row.reason)) return null;
  return {
    id: row.id,
    documentId: String(row.document_id ?? ""),
    refNo: typeof row.ref_no === "number" ? row.ref_no : null,
    sectionPosition: Number(row.section_position ?? 0),
    paragraphIndex: Number(row.paragraph_index ?? 0),
    sectionLabel: String(row.section_label ?? ""),
    previousText: typeof row.previous_text === "string" ? row.previous_text : "",
    newText: row.new_text,
    reason: row.reason,
    reasonOther: typeof row.reason_other === "string" ? row.reason_other : null,
    startsOn: String(row.starts_on ?? "").slice(0, 10),
    status,
    createdByName: typeof row.created_by_name === "string" ? row.created_by_name : null,
    createdAt: String(row.created_at ?? ""),
    approvedByName: typeof row.approved_by_name === "string" ? row.approved_by_name : null,
    approvedAs: row.approved_as === "licensee" || row.approved_as === "office_manager" ? row.approved_as : null,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
  };
}

/** "A2". */
export function amendmentRef(a: Pick<SgAmendment, "refNo">): string {
  return a.refNo ? `A${a.refNo}` : "Draft";
}

/** "Audit finding", or "Other: new bank". */
export function reasonSaid(a: Pick<SgAmendment, "reason" | "reasonOther">): string {
  return a.reason === "other" && a.reasonOther ? `Other: ${a.reasonOther}` : SG_AMENDMENT_REASONS[a.reason];
}

/** "Priya Nair", or "Marcus Tran (office manager)", as the change log names the approver. */
export function approvedBySaid(a: Pick<SgAmendment, "approvedByName" | "approvedAs">): string {
  const name = a.approvedByName ?? "A team member";
  return a.approvedAs === "office_manager" ? `${name} (office manager)` : name;
}

/** "From 3 November 2026 · Reason: audit finding · Approved by Priya Nair" (mockup screen 2). */
export function amendmentLine(a: SgAmendment): string {
  return [
    `From ${formatAuDate(a.startsOn)}`,
    `Reason: ${reasonSaid(a).replace(/^./, (c) => c.toLowerCase())}`,
    a.approvedByName ? `Approved by ${approvedBySaid(a)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The clause number a paragraph starts with, "4.2", if it has one. */
export function clauseOf(text: string): string | null {
  const m = /^\s*(\d+(?:\.\d+)+)\b/.exec(text);
  return m ? m[1] : null;
}

/**
 * What changed, for the change log: "4.2 reworded (4. Trust money)", or
 * "Paragraph added (6. Complaints)".
 */
export function whatChanged(a: Pick<SgAmendment, "previousText" | "newText" | "sectionLabel">): string {
  if (!a.previousText.trim()) {
    const clause = clauseOf(a.newText);
    return `${clause ? `${clause} added` : "Paragraph added"} (${a.sectionLabel})`;
  }
  const clause = clauseOf(a.previousText) ?? clauseOf(a.newText);
  return `${clause ? `${clause} reworded` : "Paragraph reworded"} (${a.sectionLabel})`;
}

/** For staff to sign (mockup screen 6): "A2, from 3 November 2026: 4.2 reworded (4. Trust money)". */
export function changeHeadline(a: SgAmendment): string {
  return `${amendmentRef(a)}, from ${formatAuDate(a.startsOn)}: ${whatChanged(a)}`;
}

// ── Before and after, word by word ────────────────────────────────────────

export type DiffPart = { kind: "same" | "del" | "ins"; text: string };

/** The words of a paragraph with the spaces kept, so joining them gives it back. */
function words(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Before and after, word by word (mockup screen 3): what went struck through,
 * what came in highlighted. A longest-common-run comparison; a paragraph is
 * short enough for it. Runs of the same kind are joined.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = words(before);
  const b = words(after);
  const n = a.length;
  const m = b.length;
  // Too long to compare word by word: the whole of each.
  if (n * m > 4_000_000) {
    return [
      ...(before ? [{ kind: "del" as const, text: before }] : []),
      ...(after ? [{ kind: "ins" as const, text: after }] : []),
    ];
  }
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", a[i++]);
    } else {
      push("ins", b[j++]);
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("ins", b[j++]);
  return out;
}

// ── The live document with its amendments in place ───────────────────────

export type LiveParagraph = {
  text: string;
  /** The newest approved amendment to it, if any. */
  amendment: SgAmendment | null;
  /** The wording before, newest first: each earlier amendment's, then the document's own. */
  previous: Array<{ ref: string | null; text: string }>;
};

export type LiveSection<S> = S & { live: LiveParagraph[]; refs: string[] };

/**
 * Each section with its approved amendments applied, in place (mockup screen
 * 2): a paragraph shows its newest wording, the amendment it came from, and
 * every wording before it. A paragraph added by an amendment comes after the
 * document's own. The side list marks a section with the refs that touch it.
 */
export function withAmendments<S extends { position: number; paragraphs: string[] }>(
  sections: S[],
  amendments: SgAmendment[],
): Array<LiveSection<S>> {
  const approved = amendments
    .filter((a) => a.status === "approved" && a.refNo !== null)
    .sort((x, y) => (x.refNo ?? 0) - (y.refNo ?? 0));
  return sections.map((s) => {
    const mine = approved.filter((a) => a.sectionPosition === s.position);
    const count = Math.max(s.paragraphs.length, ...mine.map((a) => a.paragraphIndex + 1));
    const live: LiveParagraph[] = [];
    for (let k = 0; k < count; k++) {
      const chain = mine.filter((a) => a.paragraphIndex === k);
      const own = s.paragraphs[k] ?? "";
      if (chain.length === 0) {
        if (k < s.paragraphs.length) live.push({ text: own, amendment: null, previous: [] });
        continue;
      }
      const newest = chain[chain.length - 1];
      const previous = [
        ...chain.slice(0, -1).reverse().map((a) => ({ ref: amendmentRef(a), text: a.newText })),
        ...(own.trim() ? [{ ref: null, text: own }] : []),
      ];
      live.push({ text: newest.newText, amendment: newest, previous });
    }
    const refs = mine.map(amendmentRef);
    return { ...s, live, refs };
  });
}

/** The wording a paragraph has now, for the amendment form to start from. */
export function currentWording<S extends { position: number; paragraphs: string[] }>(
  sections: S[],
  amendments: SgAmendment[],
  sectionPosition: number,
  paragraphIndex: number,
): string {
  const s = withAmendments(sections, amendments).find((x) => x.position === sectionPosition);
  if (!s) return "";
  const chain = amendments
    .filter((a) => a.status === "approved" && a.sectionPosition === sectionPosition && a.paragraphIndex === paragraphIndex)
    .sort((x, y) => (x.refNo ?? 0) - (y.refNo ?? 0));
  if (chain.length > 0) return chain[chain.length - 1].newText;
  return s.paragraphs[paragraphIndex] ?? "";
}

/** How many paragraphs a section has now, amendments that add one included: the next one added goes here. */
export function paragraphCount<S extends { position: number; paragraphs: string[] }>(
  section: S,
  amendments: SgAmendment[],
): number {
  const added = amendments
    .filter((a) => a.status === "approved" && a.sectionPosition === section.position)
    .map((a) => a.paragraphIndex + 1);
  return Math.max(section.paragraphs.length, ...added);
}

// ── Staff sign-off of each change ────────────────────────────────────────

/** "4 of 6": how many of the office's people now have signed. */
export function signedOf(signedBy: string[], staffIds: string[]): { signed: number; of: number } {
  const staff = new Set(staffIds);
  return { signed: new Set(signedBy.filter((id) => staff.has(id))).size, of: staff.size };
}

/** Today in Sydney, for the date an amendment starts. */
export function todayInSydney(now = new Date()): string {
  return sydneyDate(now);
}
