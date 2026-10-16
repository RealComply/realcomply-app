// The optional mobile number on the early access form (Adam, 16 Oct 2026:
// "for a quick call to get you set up"). A light check only: it never stops
// anyone registering.

const MAX = 30;

/**
 * What was typed, tidied: digits, spaces, "+", brackets, dots and dashes only,
 * spaces collapsed, trimmed, capped. Null when nothing usable was typed.
 */
export function cleanPhone(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/[^\d\s+().-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX)
    .trim();
  return /\d/.test(s) ? s : null;
}

/**
 * Whether it reads as an Australian mobile or landline, spaces allowed:
 * 04xx xxx xxx, (02) 9xxx xxxx, +61 4xx xxx xxx, 61 2 xxxx xxxx. Advisory only.
 */
export function looksAustralianPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/[\s().-]/g, "");
  return /^(?:\+?61|0)[2-478]\d{8}$/.test(digits);
}
