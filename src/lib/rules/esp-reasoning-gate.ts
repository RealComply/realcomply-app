import { getItem } from "@/lib/rules/nsw-sales";

// When the ESP reasoning card (a4c) counts as complete. One rule, used by the
// server when the card is saved, by the stage gate, by the page, and by the
// audit pack, so the four can never disagree.
//
// Raised by Adam, 2 Oct 2026: a live listing (10 Summerhaze Place) had this
// card marked done with no reasoning, no on-market properties and no
// "recorded elsewhere" tick. The card had no requirement for its own note, so
// the plain "Mark done" button closed it with the box empty.
//
// ⚠️ REVERSAL, 2 Oct 2026 (founder decision): the "my reasoning is recorded
// elsewhere" box is retired. Was (8 Sep 2026): the agent could complete the
// card by pointing at reasoning held in their CRM or on the report. Now: the
// reasoning must be in RealComply, pasted in or read from the document they
// drop in. "If an agent can simply tick that the reasoning lives somewhere
// else, it's then up to the principal to ask for it or go chasing it before he
// can sign off." Existing ticks stay on files the licensee has already signed
// off, and are shown and printed as a legacy mark. On any other file the card
// shows as not complete and asks for the reasoning.
//
// THE RULE. Complete only when all three hold:
//   a. Reasoning is in RealComply: real text, not empty, whitespace or a
//      placeholder such as "N/A". Text read from a document or drafted by
//      RealComply counts only once the agent has confirmed it, which the save
//      itself enforces (lib/rules/esp-reasoning-adoption.ts).
//   b. On the market: at least one property is recorded on the original list
//      (as at the agency agreement date), or the agent has ticked that nothing
//      comparable was on the market then.
//   c. The agent has completed the card themselves. Nothing automatic sets
//      this card done: the document read fills the box and the lists, never
//      the status.
//
// A file the licensee has already signed off keeps the card as it was signed.
// Re-opening a signed record because the rule tightened afterwards would make
// the signature read as covering something it never saw.

export const ESP_REASONING_KEY = "a4c";

export const MISSING_REASONING = "Add your reasoning: paste it in or drop in your CMA.";
export const MISSING_ON_MARKET = "Add the properties on the market, or confirm there were none.";
export const NOT_CONFIRMED = "Check the card and mark it done yourself.";

// Single words or stock fillers that say nothing about how the estimate was
// formed. Compared after stripping punctuation and case.
const PLACEHOLDERS = new Set([
  "n a",
  "na",
  "none",
  "nil",
  "no",
  "tbc",
  "tba",
  "todo",
  "to do",
  "to come",
  "see attached",
  "see report",
  "see cma",
  "see crm",
  "see file",
  "see notes",
  "as above",
  "as per report",
  "as per cma",
  "refer report",
  "refer cma",
  "test",
  "x",
]);

/** True when the text says something, rather than nothing or a placeholder. */
export function isRealReasoning(note: unknown): boolean {
  if (typeof note !== "string") return false;
  const words = note
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!words) return false;
  if (PLACEHOLDERS.has(words)) return false;
  // Needs letters, not only figures or symbols.
  return /\p{L}{3,}/u.test(words);
}

export type EspGateInput = {
  status: string | null | undefined;
  data: Record<string, unknown> | null | undefined;
  /** Properties recorded on the original on-market list (as at the agreement date). */
  onMarketCount: number;
  /** The licensee has signed the file off. */
  signedOff: boolean;
};

/** What still stops the card counting as complete, in the words the card shows. Empty when complete. */
export function espReasoningMissing(input: Omit<EspGateInput, "status"> & { status?: string | null }): string[] {
  const data = input.data ?? {};
  const missing: string[] = [];

  const legacyElsewhere = data.loggedElsewhere === true && input.signedOff;
  if (!isRealReasoning(data.note) && !legacyElsewhere) missing.push(MISSING_REASONING);

  const noneConfirmed = Boolean(data.noneOnMarket);
  if (input.onMarketCount === 0 && !noneConfirmed) missing.push(MISSING_ON_MARKET);

  return missing;
}

/** Whether the card counts as complete. A signed-off file keeps what was signed. */
export function espReasoningComplete(input: EspGateInput): boolean {
  if (input.status !== "done") return false;
  if (input.signedOff) return true;
  return espReasoningMissing(input).length === 0;
}

/**
 * The status the rest of the app should treat a4c as having. A card stored as
 * done that fails the rule reads as open, without rewriting the stored row.
 */
export function effectiveEspStatus<S extends string>(status: S, input: Omit<EspGateInput, "status">): S | "open" {
  if (status !== "done") return status;
  return espReasoningComplete({ ...input, status }) ? status : "open";
}

/**
 * Applies effectiveEspStatus to a key → item map, returning a new map. Every
 * other item is untouched.
 */
export function withEffectiveEspStatus<T extends { status: string; data?: unknown }>(
  items: Record<string, T>,
  ctx: { onMarketCount: number },
): Record<string, T> {
  const a4c = items[ESP_REASONING_KEY];
  if (!a4c || a4c.status !== "done") return items;
  const signedOff = items["sign_licensee"]?.status === "done";
  const status = effectiveEspStatus(a4c.status, {
    data: (a4c.data as Record<string, unknown> | null) ?? null,
    onMarketCount: ctx.onMarketCount,
    signedOff,
  });
  return status === a4c.status ? items : { ...items, [ESP_REASONING_KEY]: { ...a4c, status } };
}

/**
 * Stage gate. Cards in Pre-market and later wait for the ESP reasoning card.
 * Listing set-up cards (stage 0) and the ESP card itself never do.
 */
export function waitsForEspReasoning(itemKey: string): boolean {
  if (itemKey === ESP_REASONING_KEY) return false;
  const rule = getItem(itemKey);
  return Boolean(rule && rule.stage >= 1);
}

export const STAGE_GATE_MESSAGE =
  "Finish the “ESP reasoning recorded” card in Listing set-up first. Later cards wait for it.";
