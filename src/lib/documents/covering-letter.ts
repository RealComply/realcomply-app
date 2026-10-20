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
};

/** Reads the record kept on the card's data, defensively. */
export function readReceivedDate(raw: unknown): ReceivedDateRecord {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const history = Array.isArray(d.receivedDateHistory) ? (d.receivedDateHistory as ReceivedDateChange[]) : [];
  const source = d.receivedDateSource === "ai" || d.receivedDateSource === "agent" ? d.receivedDateSource : undefined;
  const noDateAt = typeof d.coveringLetterNoDateAt === "string" ? d.coveringLetterNoDateAt : undefined;
  return { history, source, noDateAt };
}

type Card = { event_date: string | null; status: string; data: unknown };

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
  if (!date) {
    data.coveringLetterNoDateAt = at;
    return { changed: false, eventDate: card.event_date, status: card.status, data };
  }
  delete data.coveringLetterNoDateAt;
  if (date === card.event_date) return { changed: false, eventDate: card.event_date, status: card.status, data };

  const { history } = readReceivedDate(card.data);
  data.receivedDateHistory = [...history, { at, source: "ai", from: card.event_date ?? null, to: date }];
  data.receivedDateSource = "ai";
  // Open, for the agent to check: saving it runs the usual checks.
  delete data.flagReason;
  return { changed: true, eventDate: date, status: "open", data };
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
): { receivedDateHistory?: ReceivedDateChange[]; receivedDateSource?: "ai" | "agent" } {
  const record = readReceivedDate(existing.data);
  const changed = (date ?? null) !== (existing.event_date ?? null);
  const history = changed
    ? [...record.history, { at, source: "agent" as const, by: actor.id, byName: actor.name, from: existing.event_date ?? null, to: date ?? null }]
    : record.history;
  const source = changed || status === "done" ? "agent" : record.source;
  return {
    ...(history.length > 0 ? { receivedDateHistory: history } : {}),
    ...(source ? { receivedDateSource: source } : {}),
  };
}

/** What the card says about its date. `date` formats a date, `when` a timestamp. */
export function receivedDateLines(
  raw: unknown,
  date: (d: string) => string,
  when: (iso: string) => string,
): { readByAi: boolean; changedFrom: string | null; noDate: boolean; history: string[] } {
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
  return { readByAi, changedFrom, noDate: Boolean(record.noDateAt), history };
}
