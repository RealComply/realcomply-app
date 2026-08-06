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

// Requirement per NSW obligation register §A: 7 hrs/yr for Class 1 & 2
// agents (Class 1 also needs a Fair Trading forum + AUSTRAC AML training on
// top of that base); assistant agents need 3 units/yr instead of hours.
export const CPD_HOURS_REQUIRED_AGENT = 7;
export const CPD_UNITS_REQUIRED_ASSISTANT = 3;

