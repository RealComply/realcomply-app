// Live links on every legal reference (Adam, 5 Nov 2026: "If we have a live
// link for this one, we should have a live link for all").
//
// A card's legal reference ("s49, Property and Stock Agents Act 2002 (NSW)",
// "PSA Reg Sch 2 s19", "RTA ss73D, 73F; RT Reg cl 22A") is split into pieces.
// Each section, clause or Schedule it cites links to that place in the law
// on the official site, as "section 63" does on the contract card (#117).
// The text the agent reads doesn't change: joining the pieces gives back the
// reference exactly.
//
// WHAT'S LINKED, AND HOW SURE WE ARE.
//   * The document ids come from the official copies this repo already
//     holds (src/lib/legislation: act-2002-066, act-1919-006, sl20220501,
//     sl20220485; the Competition and Consumer Act's C2004A00109), plus the
//     Residential Tenancies Act 2010 (No 42, act-2010-042) and the AML/CTF
//     Act 2006 (C2006A00169).
//   * "#sec.63" is the form Master gave for section 63 (5 Nov 2026), used for
//     every section and Regulation section. "#sch.2" for a Schedule.
//   * Not linked, deliberately: the Residential Tenancies Regulation 2019 and
//     the Swimming Pools Act 1992 (no official id in this repo to link to), and
//     anything this can't place. Those stay plain text, never a guessed link.
//   * Commonwealth laws link to the Act, not a section.

export type ReferencePiece = { text: string; href?: string };

type Instrument = {
  /** Words that name it in a reference. */
  names: RegExp;
  url: string;
  /** Sections and Schedules have their own anchors on the page. */
  anchors: boolean;
  kind: "act" | "regulation";
};

const NSW = "https://legislation.nsw.gov.au/view/html/inforce/current/";

const PSA_ACT: Instrument = {
  names: /Property and Stock Agents Act 2002(?: \(NSW\))?|\bPSA Act\b/,
  url: `${NSW}act-2002-066`,
  anchors: true,
  kind: "act",
};
const PSA_REG: Instrument = {
  names: /Property and Stock Agents Regulation 2022(?: \(NSW\))?|\bPSA Reg\b/,
  url: `${NSW}sl-2022-0501`,
  anchors: true,
  kind: "regulation",
};
const CONVEYANCING_ACT: Instrument = {
  names: /Conveyancing Act 1919(?: \(NSW\))?/,
  url: `${NSW}act-1919-006`,
  anchors: true,
  kind: "act",
};
const SALE_OF_LAND_REG: Instrument = {
  names: /Conveyancing \(Sale of Land\) Regulation 2022(?: \(NSW\))?/,
  url: `${NSW}sl-2022-0485`,
  anchors: true,
  kind: "regulation",
};
const RTA: Instrument = {
  names: /Residential Tenancies Act 2010(?: \(NSW\))?|\bRTA\b/,
  url: `${NSW}act-2010-042`,
  anchors: true,
  kind: "act",
};
const AML_CTF: Instrument = {
  names: /AML\/CTF Act 2006(?: \(Cth\))?/,
  url: "https://www.legislation.gov.au/C2006A00169/latest/text",
  anchors: false,
  kind: "act",
};
const ACL: Instrument = {
  names: /Australian Consumer Law/,
  url: "https://www.legislation.gov.au/C2004A00109/latest/text",
  anchors: false,
  kind: "act",
};
/** Named, but with nothing here to link to: the whole part stays plain. */
const UNLINKED = /\bRT Reg\b|Residential Tenancies Regulation|Swimming Pools Act/;

const INSTRUMENTS = [PSA_ACT, PSA_REG, CONVEYANCING_ACT, SALE_OF_LAND_REG, RTA, AML_CTF, ACL];

function named(part: string): Instrument | null {
  let best: { at: number; i: Instrument } | null = null;
  for (const i of INSTRUMENTS) {
    const m = i.names.exec(part);
    if (m && (!best || m.index < best.at)) best = { at: m.index, i };
  }
  return best?.i ?? null;
}

/** Which law a part cites when it doesn't name one: a Regulation's words, or the Act named elsewhere. */
function inferred(part: string, whole: string): Instrument {
  if (/\b[Rr]eg\b/.test(part) || /\bcll?\s?\d/.test(part) || (/\bSch\s?\d/.test(part) && /\b(rr?|cll?)\s?\d/.test(part))) {
    return PSA_REG;
  }
  for (const i of [CONVEYANCING_ACT, RTA, PSA_ACT]) if (i.names.test(whole)) return i;
  return PSA_ACT;
}

const NUM = String.raw`\d+[A-Z]{0,2}(?:\([0-9a-z]+\))*`;
// A Schedule, with the rules, clauses or sections cited in it: "Sch 2 r17",
// "Sch 1 rr 8 & 9", "Sch 2 r 3(2)(k)", "Sch 2 s26", "Sch 5".
const SCHEDULE = new RegExp(String.raw`\bSch\s?(\d+)(?:\s?(?:rr?|cll?|s)\s?${NUM}(?:\s?(?:&|and)\s?${NUM})*)?`, "g");
// A section or clause, and the rest of its list: "s49", "ss 73 & 73A",
// "ss 8, 9", "s73 / s73A", "s18/s30", "ss212 to 214", "cll 14(1), 16", "Reg 60".
const SECTION = new RegExp(String.raw`\b(?:ss?|cll?|Reg)\s?(${NUM})`, "g");
const LIST_ITEM = new RegExp(String.raw`^(\s?(?:,|&|and|/|to)\s?)(?:ss?\s?)?(\d+[A-Z]{0,2})((?:\([0-9a-z]+\))*)`);

type Hit = { start: number; end: number; href: string };

function anchor(i: Instrument, number: string): string {
  return i.anchors ? `${i.url}#sec.${number}` : i.url;
}

function hitsIn(part: string, i: Instrument): Hit[] {
  const hits: Hit[] = [];
  for (const m of part.matchAll(SCHEDULE)) {
    hits.push({ start: m.index!, end: m.index! + m[0].length, href: i.anchors ? `${i.url}#sch.${m[1]}` : i.url });
  }
  const taken = (at: number) => hits.some((h) => at >= h.start && at < h.end);
  for (const m of part.matchAll(SECTION)) {
    if (taken(m.index!)) continue;
    const number = m[1].replace(/\(.*$/, "");
    hits.push({ start: m.index!, end: m.index! + m[0].length, href: anchor(i, number) });
    // The rest of the list: "ss 8, 9", "ss212 to 214".
    let at = m.index! + m[0].length;
    for (;;) {
      const next = LIST_ITEM.exec(part.slice(at));
      if (!next) break;
      const start = at + next[1].length;
      at += next[0].length;
      hits.push({ start, end: at, href: anchor(i, next[2]) });
    }
  }
  return hits.sort((a, b) => a.start - b.start).filter((h, n, all) => n === 0 || h.start >= all[n - 1].end);
}

/** The reference in pieces, the cited places linked. Joining the pieces gives back `text`. */
export function legalReferenceLinks(text: string): ReferencePiece[] {
  const pieces: ReferencePiece[] = [];
  const push = (t: string, href?: string) => {
    if (!t) return;
    const last = pieces[pieces.length - 1];
    if (!href && last && !last.href) last.text += t;
    else pieces.push(href ? { text: t, href } : { text: t });
  };
  for (const part of text.split(/(;)/)) {
    if (part === ";" || UNLINKED.test(part)) {
      push(part);
      continue;
    }
    const instrument = named(part) ?? inferred(part, text);
    let hits = hitsIn(part, instrument);
    // A reference that names a law and cites no section: link the name.
    if (hits.length === 0) {
      const m = instrument.names.exec(part);
      if (m) hits = [{ start: m.index, end: m.index + m[0].length, href: instrument.url }];
    }
    let at = 0;
    for (const h of hits) {
      push(part.slice(at, h.start));
      push(part.slice(h.start, h.end), h.href);
      at = h.end;
    }
    push(part.slice(at));
  }
  return pieces;
}
