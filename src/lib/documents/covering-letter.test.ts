import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVERING_LETTER_KEY,
  COVERING_LETTER_NO_DATE,
  COVERING_LETTER_READ_BY_AI,
  COVERING_LETTER_SIGNED_OFF,
  COVERING_LETTER_UNREADABLE,
  afterAgentSave,
  afterLetterRead,
  coveringLetterDate,
  readReceivedDate,
  receivedDateLines,
} from "./covering-letter";
import { isAiReadItem } from "./ai-read-items";
import { getItem } from "@/lib/rules/nsw-sales";
import { formatAuDate } from "@/lib/format-date";

// The solicitor's covering letter on "Date the contract was received" (b1a;
// Adam, 20 Oct 2026). The latest action wins.

const TODAY = "2026-10-20";
const T1 = "2026-10-20T01:00:00.000Z";
const T2 = "2026-10-20T02:00:00.000Z";
const T3 = "2026-10-20T03:00:00.000Z";
const jo = { id: "jo", name: "Jo Agent (made up)" };
const when = (iso: string) => iso.slice(11, 16);
const lines = (data: unknown) => receivedDateLines(data, formatAuDate, when);

test("it is the received-date card's upload, and it is read", () => {
  assert.equal(COVERING_LETTER_KEY, "b1a");
  assert.equal(getItem("b1a")?.label, "Date the contract was received");
  assert.equal(getItem("b1a")?.evidenceLabel, "Covering letter or forwarding email");
  assert.equal(isAiReadItem("b1a"), true, "the card offers Read again, and says it is reading");
});

test("the letter's date: only a real date, not in the future, not before 2000", () => {
  assert.equal(coveringLetterDate("2026-10-15", TODAY), "2026-10-15");
  assert.equal(coveringLetterDate(" 2026-10-20 ", TODAY), "2026-10-20");
  for (const raw of [undefined, null, "", "15/10/2026", "15 October 2026", "2026-02-30", "2026-13-01", 20261015]) {
    assert.equal(coveringLetterDate(raw, TODAY), null, String(raw));
  }
  assert.equal(coveringLetterDate("2026-10-21", TODAY), null);
  assert.equal(coveringLetterDate("1999-12-31", TODAY), null);
});

test("a blank date is filled from a dated letter, as read by AI, and the card stays open for the agent to check", () => {
  const next = afterLetterRead({ event_date: null, status: "open", data: {} }, "2026-10-14", T1);
  assert.equal(next.changed, true);
  assert.equal(next.eventDate, "2026-10-14");
  assert.equal(next.status, "open");
  assert.deepEqual(readReceivedDate(next.data).history, [{ at: T1, source: "ai", from: null, to: "2026-10-14" }]);
  const shown = lines(next.data);
  assert.equal(shown.readByAi, true);
  assert.equal(shown.changedFrom, null, "nothing was replaced");
  assert.deepEqual(shown.history, ["01:00. Read by AI from the covering letter: set to 14 October 2026."]);
});

test("a typed date, then the letter: the letter's date replaces it, says so, and the history keeps both", () => {
  // The agent typed 1 Oct and marked the card done.
  const typed = afterAgentSave({ event_date: null, data: {} }, "2026-10-01", "done", jo, T1);
  const card = { event_date: "2026-10-01", status: "done", data: { evidenceFileName: "letter.pdf", ...typed } };
  const next = afterLetterRead(card, "2026-10-14", T2);
  assert.equal(next.changed, true);
  assert.equal(next.eventDate, "2026-10-14");
  assert.equal(next.status, "open", "reopened for the agent to check; saving it runs the usual checks");
  assert.equal(next.data.evidenceFileName, "letter.pdf", "the rest of the card is kept");
  const shown = lines(next.data);
  assert.equal(shown.changedFrom, "Changed from 1 October 2026 to 14 October 2026, from the covering letter.");
  assert.deepEqual(shown.history, [
    "01:00. Jo Agent (made up): set to 1 October 2026.",
    "02:00. Read by AI from the covering letter: 1 October 2026 to 14 October 2026.",
  ]);
});

test("the letter, then a typed date: the typed date stands, until the letter is read again", () => {
  const read = afterLetterRead({ event_date: null, status: "open", data: {} }, "2026-10-14", T1);
  const typed = afterAgentSave({ event_date: "2026-10-14", data: read.data }, "2026-10-16", "done", jo, T2);
  const data = { ...read.data, ...typed };
  assert.equal(typed.receivedDateSource, "agent");
  const shown = lines(data);
  assert.equal(shown.readByAi, false, "the agent's date: no AI line");
  assert.equal(shown.changedFrom, null);
  assert.deepEqual(shown.history, [
    "01:00. Read by AI from the covering letter: set to 14 October 2026.",
    "02:00. Jo Agent (made up): 14 October 2026 to 16 October 2026.",
  ]);
  // Read again: the latest action wins.
  const again = afterLetterRead({ event_date: "2026-10-16", status: "done", data }, "2026-10-14", T3);
  assert.equal(again.eventDate, "2026-10-14");
  assert.equal(lines(again.data).changedFrom, "Changed from 16 October 2026 to 14 October 2026, from the covering letter.");
  assert.equal(readReceivedDate(again.data).history.length, 3);
});

test("the agent marking the AI's date done, unchanged, makes it theirs, with no new history line", () => {
  const read = afterLetterRead({ event_date: null, status: "open", data: {} }, "2026-10-14", T1);
  const saved = afterAgentSave({ event_date: "2026-10-14", data: read.data }, "2026-10-14", "done", jo, T2);
  assert.equal(saved.receivedDateSource, "agent");
  assert.equal(saved.receivedDateHistory?.length, 1);
});

test("the same date again changes nothing, and adds nothing to the history", () => {
  const read = afterLetterRead({ event_date: null, status: "open", data: {} }, "2026-10-14", T1);
  const card = { event_date: "2026-10-14", status: "done", data: { ...read.data, receivedDateSource: "agent" } };
  const again = afterLetterRead(card, "2026-10-14", T2);
  assert.equal(again.changed, false);
  assert.equal(again.status, "done");
  assert.equal(readReceivedDate(again.data).history.length, 1);
});

test("an undated letter changes nothing, and the card says so", () => {
  const card = { event_date: "2026-10-01", status: "done", data: { receivedDateSource: "agent" } };
  const next = afterLetterRead(card, null, T1);
  assert.equal(next.changed, false);
  assert.equal(next.eventDate, "2026-10-01");
  assert.equal(next.status, "done");
  assert.equal(readReceivedDate(next.data).history.length, 0);
  assert.equal(lines(next.data).noDate, true);
  assert.equal(COVERING_LETTER_NO_DATE, "No date found in the covering letter.");
  // A later read that finds a date clears the message.
  assert.equal(lines(afterLetterRead({ ...card, data: next.data }, "2026-10-14", T2).data).noDate, false);
});

test("a contract-after-launch flag from the old date is cleared: the agent re-saves, and the check runs again", () => {
  const card = { event_date: "2026-10-18", status: "flagged", data: { flagReason: "after launch" } };
  const next = afterLetterRead(card, "2026-10-14", T1);
  assert.equal(next.status, "open");
  assert.equal("flagReason" in next.data, false);
});

test("the words: no em dash, never 'compliant'", () => {
  for (const text of [COVERING_LETTER_NO_DATE, COVERING_LETTER_UNREADABLE, COVERING_LETTER_SIGNED_OFF, COVERING_LETTER_READ_BY_AI]) {
    assert.ok(!text.includes("—"), text);
    assert.ok(!/compliant/i.test(text), text);
  }
});
