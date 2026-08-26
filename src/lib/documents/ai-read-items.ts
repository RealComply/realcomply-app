// Which compliance items have a document the AI actually reads.
//
// Used by the evidence uploader to decide whether to offer a "Read it again"
// control beside the attached file, and to say "Reading the document…" rather
// than "Saving…" while the attach is in flight.
//
// Its own module, not a const in actions/extraction.ts, because that file is
// "use server" — every export there has to be an async function, so a plain
// list cannot live in it and be imported by a client component.
//
// Kept in step with two things in extraction.ts: SOURCE_ITEM_KEYS (the three
// documents collected at property set-up) and the d3 branch in
// extractForAttachment. If a fourth document ever gets a reader, it belongs in
// all three places — and the symptom of forgetting this one is a card that
// silently reads a file with nothing on screen to say so, which is exactly the
// failure this set exists to prevent.
export const AI_READ_ITEM_KEYS: ReadonlySet<string> = new Set([
  "a3", // agency agreement
  "b1", // contract for sale
  "a4", // comparable-sales report
  "d3", // notice of revised estimated selling price
]);

export function isAiReadItem(itemKey: string): boolean {
  return AI_READ_ITEM_KEYS.has(itemKey);
}
