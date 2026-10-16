// The name on a licence, certificate of registration or CPD certificate,
// against the person's name in RealComply. Pure, so the rule and the held
// read are tested without a database or a model call.
//
// REVERSAL (Adam, 15 Oct 2026): was (2 Oct licence-read brief, rule 4, kept strict in #45): a holder name mismatch on a personal licence saves nothing. Now: show what was read and ask the user to confirm it's this person's licence; Yes saves, No removes the file.
//
// Sue Edwards at Cass Property is "Sue Edwards" in RealComply and "Susan
// Elizabeth Edwards" on her licence, so the read refused it. Anyone whose
// licence shows their full legal name hit the same wall.
//
// THE RULE NOW
//   * Names match only when they are the same after ignoring case,
//     punctuation and extra spaces. Any other difference asks.
//   * Asking saves nothing. What was read travels with the question, signed
//     (lib/pending-read.ts), so "Yes" saves exactly what was shown and
//     nothing typed in between; "No" removes the file.
//   * The corporation licence keeps its own check (#45, the licensed entity
//     name). Nothing here touches it.

/** "SMITH, Jane-Maree " -> "smith jane maree". Case, punctuation and spacing only. */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the two names are the same once case, punctuation and extra spaces are ignored. */
export function sameName(a: string, b: string): boolean {
  const x = normaliseName(a);
  return x.length > 0 && x === normaliseName(b);
}

/** "Jo" from "Jo Bennett", for "Yes, it's Jo's". The whole name when it is one word. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** "Jo’s". */
export function possessive(name: string): string {
  return `${name}’s`;
}
