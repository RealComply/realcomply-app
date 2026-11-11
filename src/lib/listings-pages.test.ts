import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLine,
  findOnPages,
  groupWarning,
  groupWarningText,
  PAGE_NOT_READ_THIS_MORNING,
  pageNotRead,
  pagesToTry,
  searchLine,
  type PageCheck,
} from "@/lib/listings-pages";
import { signupListingsPage } from "@/lib/auth/signup-listings-page";

// An agent's own listings page for the daily price check (Adam, 2 Nov 2026; 0105).

const AGENT = "https://www.example-agency.invalid/agents/jo";
const OFFICE = "https://www.example-agency.invalid/sale";

test("the agent's own page is tried first, then the office page", () => {
  assert.deepEqual(pagesToTry(AGENT, OFFICE), [
    { kind: "agent", url: AGENT },
    { kind: "office", url: OFFICE },
  ]);
  assert.deepEqual(pagesToTry(null, OFFICE), [{ kind: "office", url: OFFICE }]);
  assert.deepEqual(pagesToTry(AGENT, null), [{ kind: "agent", url: AGENT }]);
  assert.deepEqual(pagesToTry(OFFICE, OFFICE), [{ kind: "agent", url: OFFICE }], "the same page is looked at once");
  assert.deepEqual(pagesToTry(null, null), []);
});

test("found on the agent's page: the office page isn't looked at", async () => {
  const looked: string[] = [];
  const result = await findOnPages(pagesToTry(AGENT, OFFICE), async (page) => {
    looked.push(page.kind);
    return { url: `${page.url}/listing-1`, result: "found" };
  });
  assert.deepEqual(looked, ["agent"]);
  assert.equal(result.url, `${AGENT}/listing-1`);
  assert.deepEqual(result.tries, [{ page: "agent", result: "found" }]);
});

test("not on the agent's page: falls back to the office page", async () => {
  const result = await findOnPages(pagesToTry(AGENT, OFFICE), async (page) =>
    page.kind === "agent" ? { url: null, result: "no_match" } : { url: `${OFFICE}/listing-1`, result: "found" },
  );
  assert.equal(result.url, `${OFFICE}/listing-1`);
  assert.deepEqual(result.tries, [
    { page: "agent", result: "no_match" },
    { page: "office", result: "found" },
  ]);
});

test("found nowhere: every look is kept, and the listing says why", async () => {
  const result = await findOnPages(pagesToTry(AGENT, OFFICE), async (page) =>
    page.kind === "agent" ? { url: null, result: "no_links" } : { url: null, result: "refused" },
  );
  assert.equal(result.url, null);
  // Neither page could be read (no links; turned away): Adam's sentence, not "didn't include" (11 Nov 2026).
  const line = searchLine({ at: "2026-11-02T20:00:30Z", tries: result.tries }, {}, new Date("2026-11-02T21:30:00Z"));
  assert.equal(line, "We couldn't read the listings on your website page this morning, so this listing wasn't checked against it.");
  assert.equal(searchLine({ at: "2026-11-02T20:00:30Z", tries: [{ page: "office", result: "found" }] }), null);
  assert.equal(searchLine(null), null);
});

const now = new Date("2026-11-02T21:30:00Z"); // 8:30am, 3 Nov 2026 in Sydney
const check = (over: Partial<PageCheck> = {}): PageCheck => ({
  pageKey: "agent:p1",
  url: AGENT,
  checkedAt: "2026-11-02T20:00:40Z", // 7:00am, 3 Nov 2026 in Sydney
  outcome: "read",
  listingsFound: 12,
  inRealcomply: 2,
  keptUrl: null,
  ...over,
});

test("the line under the field after the morning's check, in Adam's words", () => {
  assert.equal(checkLine(check(), AGENT, now), "Checked this morning: 12 listings found, 2 in RealComply");
  assert.equal(checkLine(check({ listingsFound: 1, inRealcomply: 1 }), AGENT, now), "Checked this morning: 1 listing found, 1 in RealComply");
  assert.equal(
    checkLine(check({ checkedAt: "2026-10-31T20:00:40Z" }), AGENT, now),
    "Last checked 1 November 2026: 12 listings found, 2 in RealComply",
  );
  assert.equal(checkLine(check(), "https://www.example-agency.invalid/agents/someone-else", now), "Not checked yet. RealComply checks it each morning at 7am.");
  assert.equal(checkLine(null, AGENT, now), "Not checked yet. RealComply checks it each morning at 7am.");
  assert.equal(checkLine(check(), null, now), null);
  assert.match(checkLine(check({ outcome: "refused", listingsFound: null }), AGENT, now) ?? "", /^Checked this morning: the website turned RealComply's check away/);
  assert.match(checkLine(check({ outcome: "failed", listingsFound: null }), AGENT, now) ?? "", /couldn't read this page/);
});

test("the group-page warning: more than 3 times as many listings as in RealComply", () => {
  assert.deepEqual(groupWarning(check({ listingsFound: 7, inRealcomply: 2 }), AGENT), { found: 7, inRealcomply: 2 });
  assert.equal(groupWarning(check({ listingsFound: 6, inRealcomply: 2 }), AGENT), null, "exactly 3 times is not more than");
  assert.equal(groupWarning(check({ listingsFound: 40, inRealcomply: 0 }), AGENT), null, "nothing in RealComply to match yet");
  assert.equal(groupWarning(check({ listingsFound: 40, keptUrl: AGENT }), AGENT), null, "Keep this one was pressed for this page");
  assert.deepEqual(groupWarning(check({ listingsFound: 40, keptUrl: OFFICE }), AGENT), { found: 40, inRealcomply: 2 }, "kept a different page");
  assert.equal(groupWarning(check({ listingsFound: 40, outcome: "refused" }), AGENT), null);
  assert.equal(groupWarning(check({ listingsFound: 40 }), OFFICE), null, "a check of another address");
  assert.equal(
    groupWarningText({ found: 40, inRealcomply: 2 }),
    "This page may be the whole group's. This morning it showed 40 listings, but you have 2 in RealComply. Checking a page this size is slower and more likely to match the wrong property. If you have your own page, use that instead.",
  );
});

test("the sign-up field is optional and never stops a sign-up", () => {
  assert.equal(signupListingsPage("raineandhorne.com.au/agents/jo"), "https://raineandhorne.com.au/agents/jo");
  assert.equal(signupListingsPage("http://example-agency.invalid/agents/jo"), "https://example-agency.invalid/agents/jo");
  assert.equal(signupListingsPage(""), null);
  assert.equal(signupListingsPage("   "), null);
  assert.equal(signupListingsPage("not a page"), null);
  assert.equal(signupListingsPage(null), null);
});

// NO FALSE "DIDN'T INCLUDE THIS PROPERTY" (Adam, 11 Nov 2026). Global
// Property's page draws its listings in after it loads: the morning read found
// 0 listings, and 13 listings said "the listings on it didn't include this
// property". A page whose read found none, or turned the check away, is said
// to be unread instead.
test("a page whose morning read found 0 listings: the listing isn't said to be missing from it", () => {
  const at = "2026-11-10T20:01:10Z"; // 7:01am, 11 Nov 2026 in Sydney
  const morning = new Date("2026-11-10T23:00:00Z"); // 10am the same day
  const read0 = (pageKey: string, url: string): PageCheck => ({
    pageKey, url, checkedAt: "2026-11-10T20:00:25Z", outcome: "read", listingsFound: 0, inRealcomply: 12, keptUrl: null,
  });
  const reads = { agent: read0("agent:p1", AGENT), office: read0("office:a1", OFFICE) };
  const tries = [{ page: "agent" as const, result: "no_match" as const }, { page: "office" as const, result: "no_match" as const }];
  assert.equal(searchLine({ at, tries }, reads, morning), PAGE_NOT_READ_THIS_MORNING);
  assert.equal(PAGE_NOT_READ_THIS_MORNING, "We couldn't read the listings on your website page this morning, so this listing wasn't checked against it.");
  // Seen on a later day: the day it was looked, not "this morning".
  assert.equal(
    searchLine({ at, tries }, reads, new Date("2026-11-12T00:00:00Z")),
    "We couldn't read the listings on your website page on 11 November 2026, so this listing wasn't checked against it.",
  );
  // Without what the page read found, as before.
  assert.match(searchLine({ at, tries }, {}, morning) ?? "", /didn't include this property/);
});

test("a page that turned the check away, the same", () => {
  const refused: PageCheck = { pageKey: "office:a1", url: OFFICE, checkedAt: "2026-11-10T20:00:25Z", outcome: "refused", listingsFound: null, inRealcomply: 1, keptUrl: null };
  assert.equal(pageNotRead(refused), true);
  const at = "2026-11-10T20:01:10Z";
  assert.equal(searchLine({ at, tries: [{ page: "office", result: "refused" }] }, { office: refused }, new Date("2026-11-10T23:00:00Z")), PAGE_NOT_READ_THIS_MORNING);
});

test("a page whose read found listings, none of them this one: still said, as it's true", () => {
  const found: PageCheck = { pageKey: "office:a1", url: OFFICE, checkedAt: "2026-11-10T20:00:25Z", outcome: "read", listingsFound: 37, inRealcomply: 17, keptUrl: null };
  assert.equal(pageNotRead(found), false);
  const line = searchLine({ at: "2026-11-10T20:01:10Z", tries: [{ page: "office", result: "no_match" }] }, { office: found }, new Date("2026-11-10T23:00:00Z"));
  assert.equal(line, "This listing's page wasn't found on 11 November 2026. Looked at the office's listings page: the listings on it didn't include this property.");
});

test("one page unread, the other read: each says what it came to", () => {
  const at = "2026-11-10T20:01:10Z";
  const reads = {
    agent: { pageKey: "agent:p1", url: AGENT, checkedAt: "2026-11-10T20:00:20Z", outcome: "read" as const, listingsFound: 0, inRealcomply: 2, keptUrl: null },
    office: { pageKey: "office:a1", url: OFFICE, checkedAt: "2026-11-10T20:00:25Z", outcome: "read" as const, listingsFound: 37, inRealcomply: 17, keptUrl: null },
  };
  const line = searchLine({ at, tries: [{ page: "agent", result: "no_match" }, { page: "office", result: "no_match" }] }, reads, new Date("2026-11-10T23:00:00Z"));
  assert.equal(
    line,
    "This listing's page wasn't found on 11 November 2026. Looked at the agent's personal listings page: RealComply couldn't read the listings on it; the office's listings page: the listings on it didn't include this property.",
  );
});

test("a look from an earlier day: the page's latest read speaks for it", () => {
  // Looked for on 9 Nov ("Check now"); the page read 0 listings this morning, 11 Nov.
  const today: PageCheck = { pageKey: "office:a1", url: OFFICE, checkedAt: "2026-11-10T20:00:25Z", outcome: "read", listingsFound: 0, inRealcomply: 17, keptUrl: null };
  const old = { at: "2026-11-09T04:04:12Z", tries: [{ page: "office" as const, result: "no_match" as const }] };
  assert.equal(searchLine(old, { office: today }, new Date("2026-11-10T23:00:00Z")), PAGE_NOT_READ_THIS_MORNING);
  // Seen the next day, before that morning's read: as of the read's day.
  assert.equal(
    searchLine(old, { office: today }, new Date("2026-11-11T19:00:00Z")),
    "We couldn't read the listings on your website page on 11 November 2026, so this listing wasn't checked against it.",
  );
  // The page read listings this morning: the old look stands, with its day.
  const readable = { ...today, listingsFound: 37 };
  assert.equal(
    searchLine(old, { office: readable }, new Date("2026-11-10T23:00:00Z")),
    "This listing's page wasn't found on 9 November 2026. Looked at the office's listings page: the listings on it didn't include this property.",
  );
});

test("the words: no dashes, never 'compliant'", () => {
  for (const t of [PAGE_NOT_READ_THIS_MORNING]) {
    assert.doesNotMatch(t, /[\u2013\u2014]/);
    assert.doesNotMatch(t, /compliant/i);
  }
});
