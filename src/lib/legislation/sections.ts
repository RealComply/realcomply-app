import { PSA_ACT_2002_TEXT } from "./psa-act-2002";
import { PSA_REGULATION_2022_TEXT } from "./psa-regulation-2022";
import { CONVEYANCING_ACT_1919_TEXT } from "./conveyancing-act-1919";
import { CONVEYANCING_SALE_OF_LAND_REGULATION_2022_TEXT } from "./conveyancing-sale-of-land-regulation-2022";
import { RESIDENTIAL_TENANCIES_ACT_2010_TEXT } from "./residential-tenancies-act-2010";
import { AUSTRALIAN_CONSUMER_LAW_TEXT } from "./australian-consumer-law";

// Cutting the six Acts into sections, and finding the handful that answer a
// question.
//
// WHY THIS EXISTS. Ask the Act used to send all six texts — about 1.5 million
// characters — to the model on every single question. It was slow, it was
// expensive, and it made the model read a statute book to find one line.
// This finds the sections that actually bear on the question and sends those.
//
// NO EMBEDDINGS, NO VECTOR DATABASE, DELIBERATELY. Legislation is the friendly
// case for plain keyword search: the question and the section use the same
// vocabulary far more often than not, every section is already labelled with
// its number and heading, and there are only about 1,300 of them. A vector
// store would add a service to run, an index to keep in step with the texts,
// and a second thing to be wrong. The gap it would close — someone asking in
// words the Act never uses — is closed here by an explicit synonym list that
// can be read and corrected by a person.

export type LegislationSection = {
  /** Full name, as it should be cited. */
  source: string;
  /** Short label used in the prompt, e.g. "PSA Act". */
  short: string;
  /** "72A", or "3" for a Schedule rule. */
  number: string;
  heading: string;
  /** The Part/Division/Schedule it sits under, where the text gave one. */
  context: string;
  body: string;
  /** "PSA Act s 72A" or "PSA Reg Sch 1 r 3". */
  citation: string;
};

const SOURCES: ReadonlyArray<readonly [string, string, string]> = [
  ["Property and Stock Agents Act 2002 (NSW)", "PSA Act", PSA_ACT_2002_TEXT],
  ["Property and Stock Agents Regulation 2022 (NSW)", "PSA Reg", PSA_REGULATION_2022_TEXT],
  ["Conveyancing Act 1919 (NSW)", "Conveyancing Act", CONVEYANCING_ACT_1919_TEXT],
  ["Conveyancing (Sale of Land) Regulation 2022 (NSW)", "Sale of Land Reg", CONVEYANCING_SALE_OF_LAND_REGULATION_2022_TEXT],
  ["Residential Tenancies Act 2010 (NSW)", "RT Act", RESIDENTIAL_TENANCIES_ACT_2010_TEXT],
  ["Australian Consumer Law (Sch 2, Competition and Consumer Act 2010 (Cth))", "ACL", AUSTRALIAN_CONSUMER_LAW_TEXT],
];

// A section heading: a number, optionally lettered (72A, 55A), then a title.
// Capped at three digits so a stray year — "2022 by the Subordinate
// Legislation Act 1989" — is not mistaken for section 2022.
const HEADING = /^(\d{1,3}[A-Z]{0,3})\s+(\S.*)$/;

// Four or more dots is a contents entry's leader dots, never body text.
const DOT_LEADER = /\.{4,}/;

// Running headers and footers the PDF extraction left behind, a few lines
// deep into every page. Noise in the body dilutes the scoring and wastes
// tokens, and it is perfectly regular, so it goes.
const PAGE_NOISE = /^(Current version for|Historical version|Status Information|Page \d+ of \d+|.{0,80}\[NSW\]\s*$)/i;

// WHERE AM I — two slots, not one, and this matters for citations.
//
// Schedules 2, 3 and 4 of the Regulation carry their own Parts and Divisions
// inside them. With a single slot, the first "Division 1 Application" inside
// Schedule 2 overwrote "Schedule 2", and every rule under it was then cited
// as "PSA Reg s 1" instead of "PSA Reg Sch 2 r 1". Schedule 2 vanished from
// the index entirely, and Schedule 2 is the rules specific to real estate
// agents — the ones this product cites most.
//
// A wrong citation is worse than no answer. Someone looks up "s 1" of the
// Regulation, finds the commencement clause, and concludes the tool is
// making things up — or worse, does not check.
//
// Both patterns require a space and then a LETTER after the number, which is
// what separates a real heading from a cross-reference in running text:
// "Schedule 5, section 9, and" and "Part 8, Division 1A," were both being
// read as headings and were both wrong.
// The em dash in DIVISION is not decoration. The two NSW instruments write
// "Part 1 Sales"; the Commonwealth ACL writes "Chapter 1—Introduction" and
// "Part 3-1—Unfair practices". Requiring a space alone stopped matching every
// ACL heading, so nothing ever cleared the schedule slot and all 495 ACL
// sections were cited as "ACL Sch 2 r 18" instead of "ACL s 18".
//
// SCHEDULE deliberately still requires a space, which is what keeps the ACL's
// own title line — "Schedule 2—The Australian Consumer Law" — from being read
// as a schedule to nest everything under. The ACL is Schedule 2 of the
// Competition and Consumer Act, but "ACL" already says that, and a licensee
// looking up "ACL Sch 2 r 18" would find nothing.
const SCHEDULE = /^Schedule\s+\d+[A-Z]?\s+[A-Za-z]/i;
const DIVISION = /^(Chapter|Part|Division|Subdivision)\s+[\d-]+[A-Z]?(?:\s+|—|–)[A-Za-z]/i;

/** Sections shorter than this are contents stubs, not law. */
const MIN_BODY = 80;

function citationFor(short: string, context: string, number: string): string {
  const schedule = /^Schedule\s+(\d+[A-Z]?)/i.exec(context);
  return schedule ? `${short} Sch ${schedule[1]} r ${number}` : `${short} s ${number}`;
}

/**
 * The line at which the contents list ends.
 *
 * The contents name every Schedule before the body does, so without this the
 * chunker enters the real text believing it is inside Schedule 14 — and every
 * Part of the Regulation proper was being labelled as sitting under
 * "Schedule 12 Terms specific to agency agreement for management of".
 *
 * Leader dots are the giveaway, and in all three texts that use them the last
 * one falls 5–7% in. The quarter-way guard is there so that a stray row of
 * dots deep inside a form template could never swallow half an Act.
 * Texts with no leader dots return 0 and lose nothing: their contents carry
 * no Schedule headings to be confused by.
 */
/**
 * Lines that repeat so often they must be page furniture, not headings.
 *
 * The ACL PDF prints "Schedule 2 The Australian Consumer Law" as a running
 * header on every page — 140 times — and it reads exactly like a schedule
 * heading, so every ACL section ended up cited as "ACL Sch 2 r 18".
 *
 * The general rule is better than another entry in PAGE_NOISE: a real heading
 * appears once, or twice counting the contents. Anything appearing nine times
 * or more is printed furniture, whatever it says, in this document or the next
 * one somebody adds.
 *
 * Used ONLY to suppress structure detection, never to drop body text. Real
 * legislative phrases do repeat — "Penalty: 100 penalty units" appears
 * constantly — and losing those from the sections would be a worse fault than
 * the one being fixed.
 */
function repeatedLines(lines: string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.trim();
    if (key.length < 15) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = new Set<string>();
  for (const [line, n] of counts) if (n > 8) repeated.add(line);
  return repeated;
}

function contentsEnd(lines: string[]): number {
  let last = -1;
  lines.forEach((line, i) => {
    if (DOT_LEADER.test(line)) last = i;
  });
  return last > 0 && last < lines.length * 0.25 ? last : 0;
}

function chunk(source: string, short: string, text: string): LegislationSection[] {
  const out: LegislationSection[] = [];
  let current: Omit<LegislationSection, "body" | "citation"> | null = null;
  let schedule = "";
  let division = "";
  let buffer: string[] = [];

  const where = () => [schedule, division].filter(Boolean).join(" — ");

  const flush = () => {
    if (current) {
      out.push({
        ...current,
        body: buffer.join("\n").trim(),
        citation: citationFor(short, current.context, current.number),
      });
    }
    buffer = [];
  };

  const lines = text.split(/\r?\n/);
  const bodyStarts = contentsEnd(lines);
  const furniture = repeatedLines(lines);

  for (const [index, raw] of lines.entries()) {
    const line = raw.replace(/\s+$/, "");
    if (DOT_LEADER.test(line) || PAGE_NOISE.test(line.trim())) continue;
    if (index <= bodyStarts) continue;

    const trimmed = line.trim();
    // A new Schedule resets the Part/Division within it; a Part or Division
    // never clears the Schedule it sits inside.
    if (!furniture.has(trimmed)) {
      if (SCHEDULE.test(trimmed)) {
        schedule = trimmed;
        division = "";
      } else if (DIVISION.test(trimmed)) {
        division = trimmed;
      }
    }

    const match = HEADING.exec(trimmed);
    if (match) {
      flush();
      current = { source, short, number: match[1], heading: match[2].trim(), context: where() };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  // Most texts carry their contents list before the body, so a section number
  // appears twice: once with nothing under it, once with the law. Keep the
  // fuller of the two.
  //
  // Keyed on CONTEXT AND NUMBER, not number alone. The Regulation's Schedule 1
  // rules are numbered 1, 2, 3 — the same numbers as its opening clauses — and
  // keying on the number alone silently discarded the rules of conduct, which
  // are among the most cited provisions in this whole product.
  const best = new Map<string, LegislationSection>();
  for (const section of out) {
    const key = `${section.context}::${section.number}`;
    const existing = best.get(key);
    if (!existing || section.body.length > existing.body.length) best.set(key, section);
  }

  return [...best.values()].filter((s) => s.body.length >= MIN_BODY);
}

let cache: LegislationSection[] | null = null;

/** Every section of all six sources. Built once per server process. */
export function allSections(): LegislationSection[] {
  if (!cache) cache = SOURCES.flatMap(([source, short, text]) => chunk(source, short, text));
  return cache;
}

// ─────────────────────────────────────────────────────────────────────────
// Finding the right ones
// ─────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out",
  "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "who",
  "boy", "did", "she", "use", "way", "any", "say", "does", "what", "when", "where", "which", "with",
  "have", "this", "that", "from", "they", "been", "will", "would", "there", "their", "about", "into",
  "must", "need", "needs", "should", "could", "much", "many", "long", "under", "over", "than", "then",
  "them", "were", "your", "just", "like", "also", "some", "such", "only", "same", "each", "before",
  "after", "does", "doing", "done", "tell", "know", "want", "please", "explain", "mean", "means",
]);

// Agent language on the left, statutory language on the right.
//
// This is the one place where the plainness of keyword search shows, and the
// one place it is cheap to fix. An agent asks about "underquoting"; the Act
// never uses the word. Every entry here was a question someone would really
// ask that would otherwise return nothing.
//
// Add to it freely — a missing entry is a question answered badly.
const SYNONYMS: Record<string, string[]> = {
  underquote: ["misrepresentation", "estimated", "selling", "price", "representation"],
  underquoting: ["misrepresentation", "estimated", "selling", "price", "representation"],
  esp: ["estimated", "selling", "price"],
  quote: ["representation", "price", "estimate"],
  advertise: ["advertisement", "advertising", "representation", "published"],
  advertised: ["advertisement", "advertising", "representation", "published"],
  marketing: ["advertisement", "advertising", "published"],
  cooling: ["cooling-off", "rescind", "rescission"],
  coolingoff: ["cooling-off", "rescind", "rescission"],
  commission: ["commission", "remuneration", "entitlement", "expenses"],
  rebate: ["rebate", "discount", "commission"],
  kickback: ["rebate", "discount", "benefit"],
  gift: ["gift", "benefit"],
  benefit: ["gift", "benefit"],
  trust: ["trust", "money", "account", "authorised", "deposit"],
  reconcile: ["reconciliation", "reconciled", "statement", "trust"],
  reconciliation: ["reconciliation", "statement", "trust", "account"],
  audit: ["audit", "auditor", "records"],
  material: ["material", "fact", "disclose", "disclosure"],
  disclose: ["disclosure", "disclose", "material"],
  agreement: ["agency", "agreement", "appointment"],
  listing: ["agency", "agreement", "sale", "residential"],
  auction: ["auction", "bidder", "bidders", "record", "bidding"],
  bidder: ["bidder", "bidders", "record", "auction"],
  cpd: ["continuing", "professional", "development", "training"],
  training: ["continuing", "professional", "development", "training"],
  licence: ["licence", "licensee", "certificate", "registration"],
  license: ["licence", "licensee", "certificate", "registration"],
  supervision: ["supervision", "guidelines", "licensee-in-charge", "supervise"],
  aml: ["identity", "verification"],
  tenancy: ["residential", "tenancy", "tenant", "landlord"],
  bond: ["bond", "rental", "security"],
  eviction: ["termination", "notice", "vacant", "possession"],
  evict: ["termination", "notice", "vacant", "possession"],
  // "How much notice to TERMINATE a tenancy" found sections about notice of
  // sale, because the Act says "termination" and the search matched the word
  // literally. Stemming would not have helped — "terminate" and "termination"
  // do not share a suffix rule — which is exactly why this list exists.
  terminate: ["termination", "terminating", "notice", "grounds"],
  terminating: ["termination", "notice", "grounds"],
  termination: ["termination", "notice", "grounds"],
  lease: ["tenancy", "agreement", "residential"],
  vacate: ["vacant", "possession", "termination"],
  contract: ["contract", "sale", "land", "prescribed", "documents"],
  vendor: ["vendor", "seller", "principal"],
  buyer: ["purchaser", "buyer"],
  misleading: ["misleading", "deceptive", "conduct", "representation"],
  penalty: ["penalty", "maximum", "units", "offence"],
  fine: ["penalty", "maximum", "units", "offence"],
};

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Section numbers named outright: "s 72A", "section 55", "clause 27(5)". */
function citedNumbers(query: string): string[] {
  const out: string[] = [];
  const pattern = /\b(?:s|ss|sec|section|cl|clause|reg|regulation|r|rule)\s*\.?\s*(\d{1,3}[A-Za-z]{0,3})\b/gi;
  for (const m of query.matchAll(pattern)) out.push(m[1].toUpperCase());
  return out;
}

function expand(tokens: string[]): string[] {
  const out = new Set(tokens);
  for (const token of tokens) {
    const stem = token.replace(/(ing|ed|es|s)$/, "");
    for (const extra of SYNONYMS[token] ?? SYNONYMS[stem] ?? []) out.add(extra);
  }
  return [...out];
}

export type Retrieved = { section: LegislationSection; score: number };

/**
 * Below this, the best match is not really a match.
 *
 * Calibrated against a fixed set of real questions. Ones these six sources
 * genuinely answer score 79 at worst and usually 120–320 on the top hit. Two
 * that they cannot answer — "how many CPD hours do I need?", where the
 * requirement is set outside these texts, and a question about nothing at all
 * — top out at 55 and 21.
 *
 * Set midway between those, with margin on both sides, rather than snug
 * against either. A threshold tuned to sit one point above the worst false
 * positive is a threshold tuned to a sample, and the next question is not in
 * the sample.
 *
 * The number matters because of what the product must never do. Handing the
 * model a set of vaguely-worded near-misses invites it to build an answer out
 * of them; being told plainly that nothing matched is what makes "I can't find
 * that in these sources" the natural reply. In a compliance tool, silence
 * beats a confident wrong section every time.
 */
export const WEAK_MATCH_SCORE = 65;

/**
 * The sections most likely to answer the question.
 *
 * Scoring is deliberately simple and inspectable: how rare a word is across
 * all 1,300 sections, times where it appears — a hit in the heading counts
 * for far more than one buried in the body, because a heading is the
 * draftsman's own summary of what the section is about.
 *
 * A section named outright ("what does s 72A say?") jumps the queue. That is
 * the single most common way this gets used, and no amount of word-matching
 * beats being told the answer.
 */
export function findSections(query: string, limit = 14, charBudget = 80_000): Retrieved[] {
  const sections = allSections();
  const terms = expand(tokenise(query));
  if (terms.length === 0) return [];

  // How many sections contain each term, for inverse document frequency —
  // "agent" appears everywhere and means little; "reconciliation" is worth a
  // great deal. Computed per query over a fixed corpus; at 1,300 sections
  // that is a few milliseconds and needs no precomputed index to keep in step.
  const containing = new Map<string, number>();
  for (const term of terms) {
    let n = 0;
    for (const s of sections) {
      if (s.heading.toLowerCase().includes(term) || s.body.toLowerCase().includes(term)) n += 1;
    }
    containing.set(term, n);
  }

  const wanted = new Set(citedNumbers(query));

  const scored: Retrieved[] = [];
  for (const section of sections) {
    const heading = `${section.number} ${section.heading} ${section.context}`.toLowerCase();
    const body = section.body.toLowerCase();
    let score = 0;

    for (const term of terms) {
      const n = containing.get(term) ?? 0;
      if (n === 0) continue;
      const idf = Math.log(1 + sections.length / n);
      const inHeading = heading.split(term).length - 1;
      const inBody = body.split(term).length - 1;
      if (inHeading === 0 && inBody === 0) continue;

      // Diminishing returns on repetition: a section saying "trust" forty
      // times is about trust, but not forty times more about it.
      score += idf * (inHeading * 6 + (1 + Math.log(1 + inBody)) * 3);

      // A word that appears in only a handful of sections is the whole
      // question. "When do I do the trust account RECONCILIATION" was
      // returning six sections about trust accounts and not the one about
      // reconciliation, because "trust" and "account" appear in dozens of
      // headings and swamped the one word that mattered. A rare term present
      // anywhere in a section is strong evidence on its own.
      if (n <= 6) score += idf * 8;
    }

    // Length normalisation, gently. Without it the longest sections win
    // everything; with it applied fully, one-line sections win everything.
    score /= Math.sqrt(Math.max(section.body.length, 400) / 400);

    if (wanted.has(section.number.toUpperCase())) score += 100;

    if (score > 0) scored.push({ section, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // Everything far below the best hit is padding. Sending it costs tokens and
  // gives the model more chances to cite something irrelevant.
  const floor = (scored[0]?.score ?? 0) * 0.25;

  const chosen: Retrieved[] = [];
  let chars = 0;
  for (const hit of scored) {
    if (chosen.length >= limit) break;
    if (hit.score < floor) break;
    if (chars + hit.section.body.length > charBudget && chosen.length > 0) continue;
    chosen.push(hit);
    chars += hit.section.body.length;
  }
  return chosen;
}

/** True when even the best match is too weak to answer from. */
export function isWeak(hits: Retrieved[]): boolean {
  return hits.length === 0 || hits[0].score < WEAK_MATCH_SCORE;
}

/** The retrieved sections, formatted for the model with their citations. */
export function renderSections(hits: Retrieved[]): string {
  return hits
    .map(({ section }) => {
      const context = section.context ? `${section.context}\n` : "";
      return `--- ${section.citation} — ${section.heading}\nSource: ${section.source}\n${context}\n${section.body}`;
    })
    .join("\n\n");
}
