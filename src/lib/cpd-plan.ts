// What one person's CPD is for the year, and how far through it they are.
//
// Pure, so the CPD card, the licence register, Home, the training plan and
// the printed register all answer the same way from the same ruleset
// (rules/nsw-cpd.ts). Brief of 14 Oct 2026, Parts 2 and 3:
//
//   * Minimum hours are shown per category. There is NO single combined
//     total: a topic shared by two categories only needs doing once if the
//     course covers each category's learning outcomes, so nobody can say what
//     the total is except the provider.
//   * Each compulsory topic appears once, with the categories it counts for.
//     A certificate that covers it ticks it for every one of those
//     categories; the person or their licensee can untick a category the
//     course didn't cover (cpd_records.topics_not_covered, 0073).
//   * "N of N done" counts topics and, for a Class 1 holder, the forum and
//     the AUSTRAC guide. A topic is done when it is done for every category.

import {
  CPD_CATEGORY_LABELS,
  cleanCpdCategories,
  cpdRulesetFor,
  cpdTopicKeys,
  type PracticeCategory,
  type CpdExtraKey,
  type CpdRuleset,
} from "@/lib/rules/nsw-cpd";
import { countableCpdHours } from "@/lib/cpd-hours";
import { currentCpdYear } from "@/lib/cpd-year";
import { formatAuDate } from "@/lib/format-date";
import type { LicenceType } from "@/lib/types";

export type CpdPerson = {
  licence_type: LicenceType | null;
  cpd_categories?: string[] | null;
  cpd_livestock_only?: boolean | null;
  licence_started_on?: string | null;
};

export type PlanTopic = {
  key: string;
  title: string;
  note?: string;
  /** The person's categories this topic is compulsory for, in the standard order. */
  categories: PracticeCategory[];
};

export type PlanExtra = { key: CpdExtraKey; title: string; note: string };

export type CpdPlan =
  | { kind: "no_ruleset"; message: string }
  | { kind: "unknown"; reason: "no_licence" | "no_category"; message: string }
  | { kind: "exempt"; message: string; retentionYears: number }
  | { kind: "units"; units: number; partYear: boolean; note: string; retentionYears: number }
  | {
      kind: "hours";
      class1: boolean;
      categories: PracticeCategory[];
      minimums: Array<{ category: PracticeCategory; label: string; hours: number }>;
      /** The amber note when more than one category is ticked; null otherwise. */
      sharedNote: string | null;
      topics: PlanTopic[];
      extras: PlanExtra[];
      retentionYears: number;
    };

/** The year's rules applied to one person. */
export function cpdPlanFor(person: CpdPerson, ruleset: CpdRuleset | null, yearLabel = ""): CpdPlan {
  if (!ruleset) {
    return {
      kind: "no_ruleset",
      message: `RealComply doesn't have Fair Trading's CPD requirements for ${yearLabel || "this CPD year"} yet. Upload your certificates as normal.`,
    };
  }
  const year = yearLabel || ruleset.cpdYear;
  const categories = cleanCpdCategories(person.cpd_categories);
  const isAssistant = person.licence_type === "certificate_of_registration";
  const retentionYears = isAssistant ? ruleset.retentionYears.certificate : ruleset.retentionYears.licence;

  if (!person.licence_type) {
    return {
      kind: "unknown",
      reason: "no_licence",
      message: "No licence or certificate on file, so the CPD for the year can't be worked out.",
    };
  }

  // Part year: started on or after 1 April. Not for someone who recommenced
  // after a suspension with a CPD condition, which RealComply doesn't hold.
  const started = person.licence_started_on ?? null;
  if (started && started >= ruleset.exemptFrom && started <= ruleset.yearEnd) {
    return {
      kind: "exempt",
      retentionYears,
      message: `No CPD for ${year}: a ${isAssistant ? "certificate" : "licence"} that started on or after ${formatAuDate(ruleset.exemptFrom)} is exempt for the year, and this one started on ${formatAuDate(started)}. This doesn't apply if it recommenced after a suspension with a CPD condition.`,
    };
  }

  if (isAssistant) {
    if (person.cpd_livestock_only) {
      return {
        kind: "exempt",
        retentionYears,
        message: `No CPD for ${year}: an assistant agent in stock and station who only sells livestock is exempt.`,
      };
    }
    const partYear = Boolean(started && started >= ruleset.assistant.partYearFrom && started < ruleset.exemptFrom);
    return {
      kind: "units",
      units: partYear ? ruleset.assistant.partYearUnits : ruleset.assistant.units,
      partYear,
      note: partYear
        ? `1 unit this year: the certificate started on ${formatAuDate(started!)}, 3 to 9 months before 30 June. ${ruleset.assistant.note}`
        : ruleset.assistant.note,
      retentionYears,
    };
  }

  if (categories.length === 0) {
    return {
      kind: "unknown",
      reason: "no_category",
      message: "No category of practice ticked yet. Fair Trading sets CPD per category, so tick every one this person works in.",
    };
  }

  const minimums = categories.map((c) => ({ category: c, label: CPD_CATEGORY_LABELS[c], hours: ruleset.hours[c] }));
  const largest = Math.max(...minimums.map((m) => m.hours));
  const sharedNote =
    categories.length > 1
      ? `You'll likely do more than ${largest} hours in total. A shared topic only needs doing once if the course covers each category's learning outcomes. Check with your provider.`
      : null;

  const order = (c: PracticeCategory) => categories.indexOf(c);
  const topics: PlanTopic[] = ruleset.topics
    .map((t, i) => ({ t, i, mine: t.categories.filter((c) => categories.includes(c)).sort((a, b) => order(a) - order(b)) }))
    .filter((x) => x.mine.length > 0)
    // Shared topics first (the mockup's order), then by the person's first
    // category it belongs to, then in Fair Trading's order within it.
    .sort((a, b) => b.mine.length - a.mine.length || order(a.mine[0]) - order(b.mine[0]) || a.i - b.i)
    .map(({ t, mine }) => ({ key: t.key, title: t.title, ...(t.note ? { note: t.note } : {}), categories: mine }));

  const class1 = person.licence_type === "class_1";
  const extras: PlanExtra[] = [];
  if (class1) {
    const { forum, austrac } = ruleset.class1;
    extras.push({ key: forum.key, title: forum.title, note: forum.note });
    if (categories.some((c) => austrac.categories.includes(c))) {
      extras.push({ key: austrac.key, title: austrac.title, note: austrac.note });
    }
  }

  return { kind: "hours", class1, categories, minimums, sharedNote, topics, extras, retentionYears };
}

/** "Counts for both", "Counts for all three": when a topic is shared. */
export function sharedLabel(n: number): string | null {
  if (n < 2) return null;
  if (n === 2) return "Counts for both";
  const words = ["", "", "", "three", "four", "five", "six", "seven", "eight"];
  return `Counts for all ${words[n] ?? n}`;
}

// ── Progress ────────────────────────────────────────────────────────────

export type CpdCertificate = {
  id: string;
  activity_name: string;
  provider: string | null;
  hours: number | string | null;
  completed_date: string | null;
  category?: string | null;
  source_session_id?: string | null;
  topics?: string[] | null;
  topics_not_covered?: string[] | null;
};

/**
 * A certificate ticks topics once it has a date and names the approved
 * provider who delivered it (or came from a session that did): the same test
 * the hours use (cpd-hours.ts), less the hours, which a topic doesn't need.
 */
export function countsForTopics(r: CpdCertificate): boolean {
  if (!r.completed_date) return false;
  return Boolean(r.provider && r.provider.trim()) || Boolean(r.source_session_id);
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * The topics a certificate's title names, for a certificate read before
 * topics were (cpd_records.topics null, 0073), or one the reading couldn't
 * place. Conservative on purpose: the whole topic title has to appear in the
 * certificate's title. A one-word topic ("Contracts") has to start or end it,
 * so "Commercial contracts law" doesn't count as the Contracts topic. Where
 * one topic's title sits inside another's ("Establishing and managing
 * relationships" inside "... and negotiation skills"), only the longer counts.
 */
export function topicsFromTitle(title: string, ruleset: CpdRuleset): string[] {
  const t = squash(title);
  const padded = ` ${t} `;
  const hits = ruleset.topics.filter((topic) => {
    const want = squash(topic.title);
    if (!want.includes(" ")) return t === want || t.startsWith(`${want} `) || t.endsWith(` ${want}`);
    return padded.includes(` ${want} `);
  });
  const found = hits
    .filter((a) => !hits.some((b) => b !== a && squash(b.title).includes(squash(a.title))))
    .map((topic) => topic.key);
  if (/\baccredited\b/.test(t) && /\bforum\b/.test(t)) found.push(ruleset.class1.forum.key);
  if (/\baustrac\b/.test(t) || padded.includes(" smart real estate agent ")) found.push(ruleset.class1.austrac.key);
  return found;
}

/** The topics a certificate counts for: as read or set, else from its title. */
export function topicsOf(r: CpdCertificate, ruleset: CpdRuleset): string[] {
  return Array.isArray(r.topics) ? r.topics : topicsFromTitle(r.activity_name, ruleset);
}

export type TopicProgress = PlanTopic & {
  /** Per category: done, and the certificates that cover it (ticked or not). */
  byCategory: Array<{ category: PracticeCategory; label: string; done: boolean; certificateIds: string[] }>;
  done: boolean;
  /** Some certificate covers this topic at all, so its categories can be ticked or unticked. */
  covered: boolean;
};

export type ExtraProgress = PlanExtra & { done: boolean; certificateIds: string[] };

export type CpdProgress = {
  topics: TopicProgress[];
  extras: ExtraProgress[];
  /** Items done, of items owed: topics plus extras, or units. */
  done: number;
  total: number;
  complete: boolean;
  unit: "items" | "units";
};

export function cpdProgress(plan: CpdPlan, records: CpdCertificate[], ruleset: CpdRuleset | null): CpdProgress | null {
  if (plan.kind === "units") {
    const done = countableCpdHours(records.map((r) => ({ ...r, hours: r.hours === null ? null : Number(r.hours) })));
    return { topics: [], extras: [], done, total: plan.units, complete: done >= plan.units, unit: "units" };
  }
  if (plan.kind !== "hours" || !ruleset) return null;

  const counting = records.filter(countsForTopics);
  const covering = (key: string) => counting.filter((r) => topicsOf(r, ruleset).includes(key));

  const topics: TopicProgress[] = plan.topics.map((t) => {
    const certs = covering(t.key);
    const byCategory = t.categories.map((c) => ({
      category: c,
      label: CPD_CATEGORY_LABELS[c],
      certificateIds: certs.map((r) => r.id),
      done: certs.some((r) => !(r.topics_not_covered ?? []).includes(`${t.key}:${c}`)),
    }));
    return { ...t, byCategory, done: byCategory.every((b) => b.done), covered: certs.length > 0 };
  });

  const extras: ExtraProgress[] = plan.extras.map((e) => {
    const certs = covering(e.key);
    return { ...e, done: certs.length > 0, certificateIds: certs.map((r) => r.id) };
  });

  const total = topics.length + extras.length;
  const done = topics.filter((t) => t.done).length + extras.filter((e) => e.done).length;
  return { topics, extras, done, total, complete: done >= total, unit: "items" };
}

/** True when the year's CPD can be stated and isn't done yet: what the "CPD outstanding" counts count. */
export function cpdOutstanding(plan: CpdPlan, progress: CpdProgress | null): boolean {
  if (plan.kind !== "hours" && plan.kind !== "units") return false;
  return Boolean(progress && !progress.complete);
}

/** One line for a register or a tile: "2 of 9 done", "1 of 3 units", "Exempt", or why it can't be said. */
export function cpdSummary(plan: CpdPlan, progress: CpdProgress | null): string {
  if (plan.kind === "exempt") return "Exempt this year";
  if (plan.kind === "unknown") return plan.reason === "no_category" ? "No category of practice ticked" : "No licence on file";
  if (plan.kind === "no_ruleset") return "Requirements not loaded for this year";
  if (!progress) return "";
  return progress.unit === "units"
    ? `${progress.done} of ${progress.total} ${progress.total === 1 ? "unit" : "units"}`
    : `${progress.done} of ${progress.total} done`;
}

/**
 * The requirement in words, for a training plan's snapshot (training_plans,
 * 0020): each category's minimum, never a combined total.
 */
export function cpdRequirementWords(plan: CpdPlan): { hours: number | null; units: number | null; note: string | null } {
  if (plan.kind === "units") return { hours: null, units: plan.units, note: plan.note };
  if (plan.kind !== "hours") return { hours: null, units: null, note: plan.message };
  const each = plan.minimums.map((m) => `${m.label} ${m.hours} hours`).join("; ");
  const extras = plan.extras.map((e) => e.title).join(" and ");
  const note = [
    plan.minimums.length > 1 ? `Minimum hours per category: ${each}.` : null,
    extras ? `Class 1: ${extras}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { hours: plan.minimums.length === 1 ? plan.minimums[0].hours : null, units: null, note: note || null };
}

// ── Changing what a certificate counts for ──────────────────────────────

/** The rules for the CPD year a certificate's date falls in (today's year when it has none yet). */
export function rulesetForCertificate(completedDate: string | null | undefined, now: Date = new Date()): CpdRuleset | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(completedDate ?? "") ? completedDate! : null;
  return cpdRulesetFor(currentCpdYear(iso ? new Date(`${iso}T00:00:00Z`) : now).start);
}

/** Topic keys the year's ruleset knows, once each, in its order. Anything else is dropped. */
export function cleanTopicKeys(keys: unknown, ruleset: CpdRuleset): string[] {
  const given = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string") : [];
  return cpdTopicKeys(ruleset).filter((k) => given.includes(k));
}

/**
 * Ticks or unticks one category of one topic on a certificate. Unticking
 * records "topic:category" in topics_not_covered; ticking removes it.
 */
export function withCategoryCovered(notCovered: readonly string[], topicKey: string, category: PracticeCategory, covered: boolean): string[] {
  const pair = `${topicKey}:${category}`;
  const rest = notCovered.filter((p) => p !== pair);
  return covered ? rest : [...rest, pair];
}

/** Drops unticks for topics the certificate no longer covers. */
export function notCoveredFor(notCovered: readonly string[], topics: readonly string[]): string[] {
  return notCovered.filter((p) => topics.includes(p.split(":")[0]));
}

// ── Pre-filling from the licence ────────────────────────────────────────

/**
 * The categories a licence read names, as CPD categories, for ticking them
 * the first time (brief of 14 Oct 2026, Part 1: "pre-fill from the licence
 * read where possible"). A real estate licence doesn't say which areas
 * someone works in (sales, property management, buyers agent, commercial),
 * so it ticks none of them: the person ticks those.
 */
export function categoriesFromLicenceRead(raw: unknown): PracticeCategory[] {
  const read = raw && typeof raw === "object" ? (raw as { categories?: unknown }).categories : null;
  if (!Array.isArray(read)) return [];
  const map: Record<string, PracticeCategory> = {
    stock_and_station: "stock_and_station",
    strata_management: "strata",
    business_agent: "business_broking",
    onsite_residential_property_manager: "onsite_short_term_rpm",
  };
  return cleanCpdCategories(read.map((c) => (typeof c === "string" ? map[c] : null)).filter(Boolean));
}

/** The year's rules, the person's plan, and where they are: what every screen needs, in one call. */
export function cpdStandingFor(person: CpdPerson, records: CpdCertificate[], yearStart: string, yearLabel = "") {
  const ruleset = cpdRulesetFor(yearStart);
  const plan = cpdPlanFor(person, ruleset, yearLabel);
  const progress = cpdProgress(plan, records, ruleset);
  return { ruleset, plan, progress, summary: cpdSummary(plan, progress), outstanding: cpdOutstanding(plan, progress) };
}
