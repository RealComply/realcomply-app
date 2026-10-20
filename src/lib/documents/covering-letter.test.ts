import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COVERING_LETTER_KEY,
  COVERING_LETTER_NO_DATE,
  COVERING_LETTER_UNREADABLE,
  coveringLetterDate,
  coveringLetterDraft,
} from "./covering-letter";
import { isAiReadItem } from "./ai-read-items";
import { getItem } from "@/lib/rules/nsw-sales";

// The solicitor's covering letter on "Date the contract was received" (b1a;
// Adam, 20 Oct 2026).

const TODAY = "2026-10-20";
const AT = "2026-10-20T03:00:00.000Z";

test("it is the received-date card's upload, and it is read", () => {
  assert.equal(COVERING_LETTER_KEY, "b1a");
  assert.equal(getItem("b1a")?.label, "Date the contract was received");
  assert.equal(getItem("b1a")?.evidenceLabel, "Covering letter or forwarding email");
  assert.equal(isAiReadItem("b1a"), true, "the card offers Read again, and says it is reading");
});

test("a dated letter: its date, as read", () => {
  assert.equal(coveringLetterDate("2026-10-15", TODAY), "2026-10-15");
  assert.equal(coveringLetterDate(" 2026-10-15 ", TODAY), "2026-10-15");
  assert.equal(coveringLetterDate("2026-10-20", TODAY), "2026-10-20", "dated today");
});

test("no clear date: nothing, never a guess", () => {
  for (const raw of [undefined, null, "", "15/10/2026", "15 October 2026", "2026-02-30", "2026-13-01", 20261015]) {
    assert.equal(coveringLetterDate(raw, TODAY), null, String(raw));
  }
});

test("a date after today, or before 2000, is a misreading and is not offered", () => {
  assert.equal(coveringLetterDate("2026-10-21", TODAY), null);
  assert.equal(coveringLetterDate("1999-12-31", TODAY), null);
});

test("a dated letter on a blank card: the date is offered, as a draft", () => {
  assert.deepEqual(coveringLetterDraft({ evidence_path: "ag/p/b1a/1-letter.pdf", event_date: null }, "2026-10-15", AT), {
    eventDate: "2026-10-15",
    generatedAt: AT,
  });
});

test("an undated letter: the date stays blank, and the card says so", () => {
  assert.deepEqual(coveringLetterDraft({ evidence_path: "ag/p/b1a/1-letter.pdf", event_date: null }, null, AT), {
    coveringLetterNoDate: true,
    generatedAt: AT,
  });
  assert.equal(COVERING_LETTER_NO_DATE, "No date found in the covering letter.");
});

test("a date the agent has saved is never replaced: nothing is offered over it", () => {
  assert.equal(coveringLetterDraft({ evidence_path: "ag/p/b1a/1-letter.pdf", event_date: "2026-10-01" }, "2026-10-15", AT), null);
  assert.equal(coveringLetterDraft({ evidence_path: "ag/p/b1a/1-letter.pdf", event_date: "2026-10-01" }, null, AT), null);
});

test("no letter, nothing to read", () => {
  assert.equal(coveringLetterDraft({ evidence_path: null, event_date: null }, "2026-10-15", AT), null);
  assert.equal(coveringLetterDraft(null, "2026-10-15", AT), null);
});

test("the words: no em dash", () => {
  for (const text of [COVERING_LETTER_NO_DATE, COVERING_LETTER_UNREADABLE]) assert.ok(!text.includes("—"), text);
});
