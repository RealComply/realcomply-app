// CPD year runs 1 Jul–30 Jun (RealComply-NSW-sales-obligation-register.md
// §A) — not the calendar year and not the financial-year label most people
// expect, so this is centralised rather than reimplemented per call site.
export function currentCpdYear(reference: Date = new Date()): { start: string; end: string; label: string } {
  const year = reference.getUTCFullYear();
  const isBeforeJuly = reference.getUTCMonth() < 6; // getUTCMonth() is 0-indexed; 6 = July
  const startYear = isBeforeJuly ? year - 1 : year;
  const endYear = startYear + 1;
  return {
    start: `${startYear}-07-01`,
    end: `${endYear}-06-30`,
    label: `${startYear}–${String(endYear).slice(-2)}`,
  };
}

// REMOVED 18 Aug 2026 — CPD_HOURS_REQUIRED_AGENT / CPD_UNITS_REQUIRED_ASSISTANT.
//
// The flat "7 hours for anyone with a licence" was wrong. Fair Trading sets
// CPD hours per CATEGORY OF PRACTICE, not per licence class: 7 for
// residential sales, commercial, business broking and stock & station; 6 for
// strata; 4 for on-site short-term residential property management; and
// residential property management not published for 2026–27 at all. Class 1
// holders additionally owe an accredited Fair Trading forum per category, on
// top of the core hours.
//
// The requirement now lives in src/lib/rules/nsw-cpd.ts, where it belongs —
// it is jurisdiction-specific rules content, not a date helper, and it needs
// a checked-on date because Fair Trading republishes it annually on an
// unversioned page with no legislative amendment to notice.
//
// This file keeps only the CPD-year arithmetic, which genuinely is a date
// helper and genuinely doesn't change.

