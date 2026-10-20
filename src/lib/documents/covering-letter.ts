// The solicitor's covering letter on "Date the contract was received" (b1a;
// Adam, 20 Oct 2026).
//
// On a live listing the letter enclosing the draft contract was uploaded and
// the documents were read: the contract was read, the letter was not, and the
// received date stayed blank. The letter is now read too, for one thing only:
// its own date, offered on the card as the date the contract was received.
//
// The rules here, and the words, so they are tested without the AI:
//   * only a real calendar date, written YYYY-MM-DD, counts;
//   * never a date after today (Sydney), or before 2000: a letter cannot be
//     dated in the future, and either way it is a misreading;
//   * a date the agent has saved on the card always stands. Nothing is read
//     and nothing is offered over it.

/** The card the covering letter is uploaded to. */
export const COVERING_LETTER_KEY = "b1a";

/** Said on the card (and under the button) when the letter carries no clear date. */
export const COVERING_LETTER_NO_DATE = "No date found in the covering letter.";

/** Said when the file could not be read at all. */
export const COVERING_LETTER_UNREADABLE = "Couldn't read the covering letter. Check it opens, then try again.";

/**
 * The letter's date as read, if it is one this card can offer: a real
 * YYYY-MM-DD date, not after `today` (YYYY-MM-DD, Sydney) and not before 2000.
 * Anything else is no date.
 */
export function coveringLetterDate(raw: unknown, today: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const asDate = new Date(Date.UTC(y, mo - 1, d));
  if (asDate.getUTCFullYear() !== y || asDate.getUTCMonth() !== mo - 1 || asDate.getUTCDate() !== d) return null;
  if (value < "2000-01-01" || value > today) return null;
  return value;
}

/** What a read of the letter leaves on the card, as its AI draft. */
export type CoveringLetterDraft = {
  eventDate?: string;
  coveringLetterNoDate?: true;
  generatedAt: string;
};

/**
 * What the read offers, given the card as it stands. Null when nothing should
 * be written: no letter, or a date the agent has already saved.
 */
export function coveringLetterDraft(
  card: { evidence_path?: string | null; event_date?: string | null } | null,
  date: string | null,
  at: string,
): CoveringLetterDraft | null {
  if (!card?.evidence_path || card.event_date) return null;
  return date ? { eventDate: date, generatedAt: at } : { coveringLetterNoDate: true, generatedAt: at };
}
