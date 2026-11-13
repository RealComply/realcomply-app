// The solicitor's covering letter on "Date the contract was received" (b1a;
// Adam, 20 Oct 2026).
//
// On a live listing the letter enclosing the draft contract was uploaded and
// the documents were read: the contract was read, the letter was not, and the
// received date stayed blank. The letter is read now, for one thing only: its
// own date, which becomes the date the contract was received.
//
// THE LATEST ACTION WINS (Adam, 20 Oct 2026, the second brief):
//   * reading the letter puts its date on the card, even over a date the
//     agent typed earlier, as read by AI for the agent to check;
//   * a date the agent saves after that stands, until the letter is read
//     again;
//   * when the letter's date replaces another date, the card says so:
//     "Changed from [old date] to [new date], from the covering letter.";
//   * every change is kept in the card's history: who (or the AI), when, the
//     old date and the new;
//   * a letter with no clear date changes nothing, and the card says so.
// Was (PR #66, merged): a date the agent had saved was never replaced.
//
// "For the agent to check": a date the letter changes leaves the card open,
// with the date in the box, so saving it runs the usual checks (the contract
// arriving after the listing went live is flagged on save, in setItemStatus).
// On a file the licensee has signed off the letter is read but the date is
// left as signed.
//
// That used to be the only thing keeping a signed-off file as signed: every
// other card on it could still be changed under the signature. Since 28 Oct
// 2026 (Adam) nothing on a signed-off file changes until the licensee in
// charge reopens a card, which cancels the sign-off (0100; see
// lib/rules/reopen.ts). This rule stands as it was.
//
// The rules and the words are here, so they are tested without the AI.

/** The card the covering letter is uploaded to. */
export const COVERING_LETTER_KEY = "b1a";

/** Said on the card (and under the button) when the letter carries no clear date. */
export const COVERING_LETTER_NO_DATE = "No date found in the covering letter.";

/** Said when the file could not be read at all. */
export const COVERING_LETTER_UNREADABLE = "Couldn't read the covering letter. Check it opens, then try again.";

/** Said when the file is signed off, so the letter cannot change the date. */
export const COVERING_LETTER_SIGNED_OFF =
  "This file is signed off, so the date from the covering letter wasn't put on the card.";

/** The card's line while the date on it is the one the letter gave. */
export const COVERING_LETTER_READ_BY_AI = "Read by AI from the covering letter. Check it against the letter, then save.";

/**
 * The letter's date as read, if it is one the card can take: a real
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

/** One change to the received date: the letter (AI) or a person, when, old and new. */
export type ReceivedDateChange = {
  at: string;
  source: "ai" | "agent";
  by?: string;
  byName?: string;
  from: string | null;
  to: string | null;
};

export type ReceivedDateRecord = {
  history: ReceivedDateChange[];
  /** Who put the date that is on the card now: the letter, or a person. */
  source?: "ai" | "agent";
  /** When the letter was last read and had no clear date. */
  noDateAt?: string;
  /** What the card says when the letter couldn't be read (1 Nov 2026). */
  readFailed?: string;
};

/** Reads the record kept on the card's data, defensively. */
export function readReceivedDate(raw: unknown): ReceivedDateRecord {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const history = Array.isArray(d.receivedDateHistory) ? (d.receivedDateHistory as ReceivedDateChange[]) : [];
  const source = d.receivedDateSource === "ai" || d.receivedDateSource === "agent" ? d.receivedDateSource : undefined;
  const noDateAt = typeof d.coveringLetterNoDateAt === "string" ? d.coveringLetterNoDateAt : undefined;
  const readFailed = typeof d.coveringLetterReadFailed === "string" ? d.coveringLetterReadFailed : undefined;
  return { history, source, noDateAt, readFailed };
}

/** The card as read: its date, status, data, and the file on it now (its stored path). */
type Card = { event_date: string | null; status: string; data: unknown; evidence_path?: string | null };

// WHAT THE CARD SAID ABOUT AN EARLIER FILE GOES WITH IT (Adam, 11 Nov 2026).
// A covering letter that was read, then replaced by a file that couldn't be
// read, left the card saying "No date found in the covering letter." and
// "Read by AI from the covering letter. Check it against the letter, then
// save." about a letter that was no longer there. Now every read records
// which file it was of (coveringLetterFile). When the file on the card is a
// different one, what was said about the earlier file is dropped before this
// read's outcome is written: the "no date" line and an earlier failure line
// always; the "Read by AI" line too when this file gives no date (it couldn't
// be read, or has none). The date itself stays, and so does its history. The
// same goes when the letter is removed. Read again on the same file keeps
// what was said, so a read that fails once doesn't wipe a good one.
const LETTER_FILE = "coveringLetterFile";

/** Drops what the card said about an earlier letter, when the file is a different one. Whether it was. */
function forgetEarlierLetter(data: Record<string, unknown>, path: string | null | undefined): boolean {
  if (path && data[LETTER_FILE] === path) return false;
  delete data.coveringLetterNoDateAt;
  delete data.coveringLetterReadFailed;
  delete data.coveringLetterReadFailedAt;
  return true;
}

/** The "Read by AI" line goes: the date stays, but it was read from a letter that isn't on the card any more. */
function forgetAiSource(data: Record<string, unknown>): void {
  if (data.receivedDateSource === "ai") delete data.receivedDateSource;
}

/** The card after its covering letter is removed (Adam, 11 Nov 2026): nothing said about that letter stays. */
export function afterLetterRemoved(raw: unknown): Record<string, unknown> {
  const data: Record<string, unknown> = raw && typeof raw === "object" ? { ...(raw as object) } : {};
  forgetEarlierLetter(data, null);
  forgetAiSource(data);
  delete data[LETTER_FILE];
  return data;
}

/**
 * What a read of the letter does to the card. `date` is the letter's date
 * (null when it has none). Returns the card as it should be saved, and
 * whether the date changed. A letter with no clear date changes nothing but
 * the "no date" mark; the same date as the card's changes nothing at all.
 */
export function afterLetterRead(
  card: Card,
  date: string | null,
  at: string,
): { changed: boolean; eventDate: string | null; status: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = card.data && typeof card.data === "object" ? { ...(card.data as object) } : {};
  // The offer PR #66 left in the AI draft is superseded by this record.
  delete data.aiDraft;
  const newFile = forgetEarlierLetter(data, card.evidence_path);
  if (card.evidence_path) data[LETTER_FILE] = card.evidence_path;
  // A read that finished replaces a failed one.
  delete data.coveringLetterReadFailed;
  delete data.coveringLetterReadFailedAt;
  if (!date) {
    if (newFile) forgetAiSource(data);
    data.coveringLetterNoDateAt = at;
    return { changed: false, eventDate: card.event_date, status: card.status, data };
  }
  delete data.coveringLetterNoDateAt;
  if (date === card.event_date) {
    // A new letter that gives the date already on an open card says so again,
    // where an earlier file's "Read by AI" line had gone. An agent's own date,
    // or a card marked done, is left as it is.
    if (newFile && !data.receivedDateSource && card.status !== "done") data.receivedDateSource = "ai";
    return { changed: false, eventDate: card.event_date, status: card.status, data };
  }

  const { history } = readReceivedDate(card.data);
  data.receivedDateHistory = [...history, { at, source: "ai", from: card.event_date ?? null, to: date }];
  data.receivedDateSource = "ai";
  // Open, for the agent to check: saving it runs the usual checks.
  delete data.flagReason;
  return { changed: true, eventDate: date, status: "open", data };
}

/**
 * The card after a read of the letter that didn't finish (1 Nov 2026): cut
 * off at the reader's limit, refused, or a file that won't open. Nothing else
 * changes; the card says why until a read finishes or the agent saves a date.
 * Before, a cut-off read looked like a letter with no date.
 */
export function afterLetterReadFailed(card: Card, reason: string, at: string): Record<string, unknown> {
  const data: Record<string, unknown> = card.data && typeof card.data === "object" ? { ...(card.data as object) } : {};
  if (forgetEarlierLetter(data, card.evidence_path)) forgetAiSource(data);
  if (card.evidence_path) data[LETTER_FILE] = card.evidence_path;
  data.coveringLetterReadFailed = reason;
  data.coveringLetterReadFailedAt = at;
  return data;
}

/**
 * What an agent's save of the card adds to the record: a history line when the
 * date changes, and the date becomes theirs when they change it or mark the
 * card done (that is them checking it). Merged into the data the save writes.
 */
export function afterAgentSave(
  existing: { event_date: string | null; data: unknown },
  date: string | null,
  status: string,
  actor: { id: string; name: string },
  at: string,
): {
  receivedDateHistory?: ReceivedDateChange[];
  receivedDateSource?: "ai" | "agent";
  coveringLetterReadFailed?: undefined;
  coveringLetterReadFailedAt?: undefined;
} {
  const record = readReceivedDate(existing.data);
  const changed = (date ?? null) !== (existing.event_date ?? null);
  const history = changed
    ? [...record.history, { at, source: "agent" as const, by: actor.id, byName: actor.name, from: existing.event_date ?? null, to: date ?? null }]
    : record.history;
  const source = changed || status === "done" ? "agent" : record.source;
  return {
    ...(history.length > 0 ? { receivedDateHistory: history } : {}),
    ...(source ? { receivedDateSource: source } : {}),
    // A date the agent saves answers a letter that couldn't be read.
    ...(date ? { coveringLetterReadFailed: undefined, coveringLetterReadFailedAt: undefined } : {}),
  };
}

/** What the card says about its date. `date` formats a date, `when` a timestamp. */
export function receivedDateLines(
  raw: unknown,
  date: (d: string) => string,
  when: (iso: string) => string,
): { readByAi: boolean; changedFrom: string | null; noDate: boolean; readFailed: string | null; history: string[] } {
  const record = readReceivedDate(raw);
  const readByAi = record.source === "ai";
  const last = record.history[record.history.length - 1];
  const changedFrom =
    readByAi && last?.source === "ai" && last.from && last.to
      ? `Changed from ${date(last.from)} to ${date(last.to)}, from the covering letter.`
      : null;
  const history = record.history.map((c) => {
    const who = c.source === "ai" ? "Read by AI from the covering letter" : (c.byName ?? "A team member");
    const what = c.from ? `${date(c.from)} to ${c.to ? date(c.to) : "blank"}` : `set to ${c.to ? date(c.to) : "blank"}`;
    return `${when(c.at)}. ${who}: ${what}.`;
  });
  return { readByAi, changedFrom, noDate: Boolean(record.noDateAt), readFailed: record.readFailed ?? null, history };
}
