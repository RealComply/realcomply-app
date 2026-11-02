import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkLine,
  findOnPages,
  groupWarning,
  groupWarningText,
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
  const line = searchLine({ at: "2026-11-02T20:00:30Z", tries: result.tries });
  assert.equal(
    line,
    "This listing's page wasn't found on 3 November 2026. Looked at the agent's own listings page: the page had no links to listings that RealComply could read; the office listings page: the website turned RealComply's check away.",
  );
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
