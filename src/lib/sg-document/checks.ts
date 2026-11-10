import { SG_2_1_3_ACTS } from "@/lib/sg-document/fair-trading";

// The 2.1.3 checks on an office's document (Adam's mockup, 6 Nov 2026:
// "These are flags for the licensee to look at. Saving isn't blocked."):
//   (a) it names the agency business: the office's trading name or its
//       licensed entity name appears in it;
//   (b) it names the licensee in charge;
//   (c) which of Fair Trading's 22 Acts it names.
// Plain text matching on the words read from the document, not AI, so the
// same document always gives the same answer and every flag can be checked
// by eye.

export type SgChecks = {
  business: { found: string | null; looked_for: string[] };
  licensee: { found: string | null; looked_for: string[] };
  acts: { found: string[]; missing: string[] };
  /**
   * Pages of a PDF that couldn't be read, even a page at a time (Adam, 10 Nov
   * 2026): their words aren't in the sections, so the office checks them by
   * hand. Absent when every page was read.
   */
  pages_not_read?: number[];
  /** Stretches of a Word document whose headings couldn't be picked out (words kept). */
  unmarked_stretches?: number;
};

/** Lower case, "&" as "and", every run of punctuation or space as one space. */
export function forMatching(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

const COMPANY_ENDINGS = /\s(pty\s)?(ltd|limited|pty)\s*$/;

/** The forms a name is looked for in: as written, and a company without "Pty Ltd". */
function forms(name: string): string[] {
  const whole = forMatching(name).trim();
  if (!whole) return [];
  const out = new Set([whole]);
  const bare = ` ${whole}`.replace(COMPANY_ENDINGS, "").trim();
  if (bare && bare.split(" ").length >= 1 && bare !== whole) out.add(bare);
  return [...out];
}

/** A person's name, as written and as first and last name only. */
function personForms(name: string): string[] {
  const whole = forMatching(name).trim();
  if (!whole) return [];
  const words = whole.split(" ");
  const out = new Set([whole]);
  if (words.length > 2) out.add(`${words[0]} ${words[words.length - 1]}`);
  return [...out];
}

function firstFound(text: string, names: string[], toForms: (n: string) => string[]): string | null {
  for (const name of names) {
    if (toForms(name).some((f) => f.length >= 3 && text.includes(` ${f} `))) return name;
  }
  return null;
}

const unique = (names: Array<string | null | undefined>) =>
  [...new Set(names.map((n) => (n ?? "").replace(/\s+/g, " ").trim()).filter(Boolean))];

export function sgChecks(
  documentText: string,
  office: { businessNames: Array<string | null | undefined>; licenseeNames: Array<string | null | undefined> },
): SgChecks {
  const text = forMatching(documentText);
  const business = unique(office.businessNames);
  const licensee = unique(office.licenseeNames);
  const found: string[] = [];
  const missing: string[] = [];
  for (const act of SG_2_1_3_ACTS) {
    (act.match.some((m) => text.includes(` ${forMatching(m).trim()} `)) ? found : missing).push(act.name);
  }
  return {
    business: { found: firstFound(text, business, forms), looked_for: business },
    licensee: { found: firstFound(text, licensee, personForms), looked_for: licensee },
    acts: { found, missing },
  };
}

/** The checks as kept on a document (jsonb), or null when they aren't there or can't be read. */
export function sgChecksOf(raw: unknown): SgChecks | null {
  const r = raw as Partial<SgChecks> | null | undefined;
  if (!r || typeof r !== "object" || !r.business || !r.licensee || !r.acts) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const pages = Array.isArray(r.pages_not_read)
    ? (r.pages_not_read as unknown[]).filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
    : [];
  const unmarked = typeof r.unmarked_stretches === "number" && r.unmarked_stretches > 0 ? Math.trunc(r.unmarked_stretches) : 0;
  return {
    business: { found: str(r.business.found), looked_for: list(r.business.looked_for) },
    licensee: { found: str(r.licensee.found), looked_for: list(r.licensee.looked_for) },
    acts: { found: list(r.acts.found), missing: list(r.acts.missing) },
    ...(pages.length > 0 ? { pages_not_read: pages } : {}),
    ...(unmarked > 0 ? { unmarked_stretches: unmarked } : {}),
  };
}

/** "Page 25", "Pages 26 and 27", "Pages 25 to 28", "Pages 25, 27 and 40 to 42". */
export function pagesSaid(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j === i + 1) runs.push(`${sorted[i]}`, `${sorted[j]}`);
    else runs.push(j === i ? `${sorted[i]}` : `${sorted[i]} to ${sorted[j]}`);
    i = j + 1;
  }
  const list = runs.length <= 1 ? runs.join("") : `${runs.slice(0, -1).join(", ")} and ${runs[runs.length - 1]}`;
  return `${sorted.length === 1 ? "Page" : "Pages"} ${list}`;
}

/**
 * What couldn't be read, in plain words, for the draft and the live document:
 * which pages to check in the file by hand. Empty when everything was read.
 */
export function sgReadGapLines(c: SgChecks | null): string[] {
  if (!c) return [];
  const lines: string[] = [];
  const pages = c.pages_not_read ?? [];
  if (pages.length > 0) {
    lines.push(
      `${pagesSaid(pages)} of the file couldn't be read, so ${pages.length === 1 ? "its" : "their"} words aren't in the sections here. Check ${pages.length === 1 ? "that page" : "those pages"} in the file by hand.`,
    );
  }
  const unmarked = c.unmarked_stretches ?? 0;
  if (unmarked > 0) {
    lines.push(
      `In ${unmarked === 1 ? "one part" : `${unmarked} parts`} of the document the headings couldn't be picked out, so those paragraphs sit under the section before them. Check the sections against the file.`,
    );
  }
  return lines;
}

/** One line for each check, as the draft shows it. */
export function sgCheckLines(c: SgChecks): Array<{ ok: boolean; text: string; detail: string | null }> {
  const total = c.acts.found.length + c.acts.missing.length;
  return [
    c.business.found
      ? { ok: true, text: `Names the agency business: ${c.business.found}`, detail: null }
      : {
          ok: false,
          text: "Names the agency business",
          detail: c.business.looked_for.length
            ? `Not found: ${c.business.looked_for.join(" or ")}. 2.1.3(a) asks the procedures to identify the agency business they apply to.`
            : "2.1.3(a) asks the procedures to identify the agency business they apply to.",
        },
    c.licensee.found
      ? { ok: true, text: `Names the licensee in charge: ${c.licensee.found}`, detail: null }
      : {
          ok: false,
          text: "Names the licensee in charge",
          detail: c.licensee.looked_for.length
            ? `Not found: ${c.licensee.looked_for.join(" or ")}. 2.1.3(b) asks them to identify the licensee in charge responsible for them.`
            : "2.1.3(b) asks them to identify the licensee in charge responsible for them.",
        },
    c.acts.missing.length === 0
      ? { ok: true, text: `Lists the relevant laws: all ${total} Acts on Fair Trading's minimum list`, detail: null }
      : {
          ok: false,
          text: `Lists the relevant laws: ${c.acts.found.length} of the ${total} Acts on Fair Trading's minimum list`,
          detail: `Not found: ${c.acts.missing.join("; ")}.`,
        },
  ];
}
