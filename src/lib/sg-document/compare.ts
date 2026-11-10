import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { amendmentRef, withAmendments, wordDiff, type SgAmendment } from "@/lib/sg-document/amendments";
import { sectionHeading } from "@/lib/sg-document/sections";

// Supervision guidelines part 3 (Adam's mockup, signed off 6 Nov 2026, screen
// 4): a new full version, read into sections, is compared section by section
// with the live one and the amendments approved on it. Each section says
// whether it's unchanged, changed, new or gone, and whether each amendment's
// wording was carried into the new version. One that wasn't is flagged, so the
// licensee checks it was left out on purpose. Nothing here blocks saving.

type Section = { position: number; number: string | null; title: string; paragraphs: string[] };

export type CompareChange = "same" | "changed" | "new" | "removed" | "carried" | "missing";

export type CompareRow = {
  key: string;
  /** "4. Trust money", or "1 to 3, 7, 8" for the sections with no change. */
  section: string;
  change: CompareChange;
  /** The tag: "No change", "Changed", "New section", "Removed", "Carried in", "A1 missing". */
  tag: string;
  detail: string[];
  /** The section's words before and after, for "Show before and after". */
  before?: string;
  after?: string;
};

export type MissingAmendment = { ref: string; sectionLabel: string; newText: string; approvedAt: string | null };

export type Comparison = { rows: CompareRow[]; missing: MissingAmendment[]; amendmentCount: number };

/** For comparing: the same words whatever the spacing, quotes, dashes or capitals. */
export function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** How alike two paragraphs are, word for word: 1 the same, 0 nothing shared. */
export function similarity(a: string, b: string): number {
  const x = normalise(a);
  const y = normalise(b);
  if (x === y) return 1;
  if (!x || !y) return 0;
  const parts = wordDiff(x, y);
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const same = parts.filter((p) => p.kind === "same").reduce((n, p) => n + words(p.text), 0);
  const total = words(x) + words(y);
  return total === 0 ? 0 : (2 * same) / total;
}

/** Close enough to be the same wording: a typo or a space apart. */
export const CARRIED_IN = 0.9;

function sectionKey(s: Pick<Section, "number" | "title">): string {
  const n = (s.number ?? "").trim().replace(/\.$/, "");
  return n ? `n:${n}` : `t:${normalise(s.title)}`;
}

function shortText(text: string, max = 110): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** "1 to 3, 7, 8" from the sections with no change, by number where they have one. */
export function sectionRuns(sections: Array<Pick<Section, "number" | "title">>): string {
  const nums = sections.map((s) => (s.number ?? "").trim().replace(/\.$/, ""));
  if (nums.some((n) => !/^\d+$/.test(n))) return sections.map((s) => sectionHeading(s)).join(", ");
  const sorted = [...new Set(nums.map(Number))].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(j - i >= 2 ? `${sorted[i]} to ${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return runs.join(", ");
}

/**
 * The new version against the live one with its amendments (screen 4).
 * Sections are matched by number, else by title. An amendment is carried in
 * when a paragraph of the new version has its wording (anywhere in the
 * document: a section may have been renumbered); otherwise it's missing.
 */
export function compareVersions(
  live: Section[],
  amendments: SgAmendment[],
  draft: Section[],
  liveLabel: string | null,
): Comparison {
  const approved = amendments.filter((a) => a.status === "approved" && a.refNo !== null).sort((x, y) => (x.refNo ?? 0) - (y.refNo ?? 0));
  const liveNow = withAmendments(live, approved);
  const byKey = new Map(liveNow.map((s) => [sectionKey(s), s]));
  const byTitle = new Map(liveNow.map((s) => [normalise(s.title), s]));
  const draftParagraphs = draft.flatMap((s) => s.paragraphs);
  const carried = (a: SgAmendment) => draftParagraphs.some((p) => similarity(p, a.newText) >= CARRIED_IN);
  const was = liveLabel ? liveLabel : "the current version";

  const rows: CompareRow[] = [];
  const same: Section[] = [];
  const matched = new Set<number>();
  const missing: MissingAmendment[] = [];

  for (const d of draft) {
    const l = byKey.get(sectionKey(d)) ?? byTitle.get(normalise(d.title));
    if (!l || matched.has(l.position)) {
      rows.push({ key: `new-${d.position}`, section: sectionHeading(d), change: "new", tag: "New section", detail: ["Added in the new version."] });
      continue;
    }
    matched.add(l.position);
    const before = l.live.map((p) => p.text).join("\n\n");
    const after = d.paragraphs.join("\n\n");
    const mine = approved.filter((a) => a.sectionPosition === l.position);
    const lost = mine.filter((a) => !carried(a));
    const kept = mine.filter((a) => carried(a));
    const detail: string[] = [];
    for (const a of kept) detail.push(`${amendmentRef(a)} (${shortText(a.newText, 70)}) is in the new wording.`);
    for (const a of lost) {
      const hadOld = a.previousText.trim() && d.paragraphs.some((p) => similarity(p, a.previousText) >= CARRIED_IN);
      detail.push(hadOld ? `Wording matches ${was} before ${amendmentRef(a)}.` : `${amendmentRef(a)}'s wording isn't in the new version.`);
      missing.push({ ref: amendmentRef(a), sectionLabel: a.sectionLabel, newText: a.newText, approvedAt: a.approvedAt });
    }
    const unchanged = normalise(before) === normalise(after);
    if (lost.length > 0) {
      rows.push({
        key: `s-${d.position}`,
        section: sectionHeading(d),
        change: "missing",
        tag: `${lost.map(amendmentRef).join(", ")} missing`,
        detail,
        ...(unchanged ? {} : { before, after }),
      });
    } else if (!unchanged) {
      rows.push({
        key: `s-${d.position}`,
        section: sectionHeading(d),
        change: "changed",
        tag: "Changed",
        detail: detail.length > 0 ? detail : ["Wording changed."],
        before,
        after,
      });
    } else if (kept.length > 0) {
      rows.push({ key: `s-${d.position}`, section: sectionHeading(d), change: "carried", tag: "Carried in", detail });
    } else {
      same.push(d);
    }
  }

  for (const l of liveNow) {
    if (matched.has(l.position)) continue;
    const lost = approved.filter((a) => a.sectionPosition === l.position && !carried(a));
    for (const a of lost) missing.push({ ref: amendmentRef(a), sectionLabel: a.sectionLabel, newText: a.newText, approvedAt: a.approvedAt });
    rows.push({
      key: `gone-${l.position}`,
      section: sectionHeading(l),
      change: lost.length > 0 ? "missing" : "removed",
      tag: lost.length > 0 ? `Removed, ${lost.map(amendmentRef).join(", ")} missing` : "Removed",
      detail: ["Not in the new version."],
    });
  }

  if (same.length > 0) {
    rows.push({ key: "same", section: sectionRuns(same), change: "same", tag: "No change", detail: [] });
  }
  return { rows, missing, amendmentCount: approved.length };
}

/**
 * The warning for an amendment not carried in (screen 4): "A1 isn't in v8.0.
 * Amendment A1 (6. Complaints: ...) was approved on 12 September 2026 but its
 * wording isn't in the new version. Check whether it was left out on purpose."
 */
export function missingLine(m: MissingAmendment, newLabel: string | null): { head: string; body: string } {
  const label = newLabel?.trim() || "the new version";
  const when = m.approvedAt ? ` was approved on ${formatAuDate(sydneyDate(new Date(m.approvedAt)))}` : " was approved";
  return {
    head: `${m.ref} isn't in ${label}.`,
    body: `Amendment ${m.ref} (${m.sectionLabel}: ${shortText(m.newText)})${when} but its wording isn't in the new version. Check whether it was left out on purpose.`,
  };
}

/** "Compared section by section with v7.3 and its 2 amendments". */
export function comparedWith(liveLabel: string | null, amendmentCount: number): string {
  const was = liveLabel ? liveLabel : "the current version";
  if (amendmentCount === 0) return `Compared section by section with ${was}`;
  return `Compared section by section with ${was} and its ${amendmentCount} ${amendmentCount === 1 ? "amendment" : "amendments"}`;
}
