import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_PAGES, analyticsUrl } from "@/lib/public-analytics";

const SITE = "https://www.realcomply.com.au";

describe("analyticsUrl: only the page and the src tag are recorded", () => {
  it("keeps the src channel tag", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=sms1`), `${SITE}/?src=sms1`);
    assert.equal(analyticsUrl(`${SITE}/?src=email1`), `${SITE}/?src=email1`);
  });

  it("records a page with no query as just the page", () => {
    assert.equal(analyticsUrl(`${SITE}/`), `${SITE}/`);
    assert.equal(analyticsUrl(`${SITE}/privacy`), `${SITE}/privacy`);
  });

  it("drops every other query value, before or after src", () => {
    assert.equal(
      analyticsUrl(`${SITE}/?utm_source=fb&src=sms1&email=jo%40example.com&fbclid=abc123`),
      `${SITE}/?src=sms1`,
    );
    assert.equal(analyticsUrl(`${SITE}/terms?ref=partner&name=Jo`), `${SITE}/terms`);
  });

  it("drops a #fragment", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=sms1#apply`), `${SITE}/?src=sms1`);
    assert.equal(analyticsUrl(`${SITE}/privacy#who-else`), `${SITE}/privacy`);
  });

  it("keeps only the first src when there are two", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=sms1&src=email1`), `${SITE}/?src=sms1`);
  });

  it("drops a src value that isn't a channel tag, and still counts the page", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=jo%40example.com`), `${SITE}/`);
    assert.equal(analyticsUrl(`${SITE}/?src=call%20me%20on%200400%20000%20000`), `${SITE}/`);
    assert.equal(analyticsUrl(`${SITE}/?src=`), `${SITE}/`);
    assert.equal(analyticsUrl(`${SITE}/?src=${"a".repeat(41)}`), `${SITE}/`);
    assert.equal(analyticsUrl(`${SITE}/?src=${"a".repeat(40)}`), `${SITE}/?src=${"a".repeat(40)}`);
  });

  it("keeps tags with dots, dashes and underscores", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=fb-oct_2026.v2`), `${SITE}/?src=fb-oct_2026.v2`);
  });

  it("takes src from the address bar when the event URL has no query, on the same page only", () => {
    assert.equal(analyticsUrl(`${SITE}/`, `${SITE}/?src=sms1&email=x%40y.com`), `${SITE}/?src=sms1`);
    assert.equal(analyticsUrl(`${SITE}/privacy`, `${SITE}/?src=sms1`), `${SITE}/privacy`);
    assert.equal(analyticsUrl(`${SITE}/`, "not a url"), `${SITE}/`);
  });

  it("the event's own src wins over the address bar", () => {
    assert.equal(analyticsUrl(`${SITE}/?src=email1`, `${SITE}/?src=sms1`), `${SITE}/?src=email1`);
  });

  it("never records a page that isn't one of the public pages", () => {
    for (const path of ["/login", "/signup", "/dashboard", "/dashboard/home", "/dashboard/3f2a/summary?x=1", "/accept-terms", "/unsubscribe/abc"]) {
      assert.equal(analyticsUrl(`${SITE}${path}`), null, path);
      assert.equal(analyticsUrl(`${SITE}${path}?src=sms1`), null, path);
    }
    assert.deepEqual([...PUBLIC_PAGES].sort(), ["/", "/dpa", "/privacy", "/terms"]);
  });

  it("does not record an event whose URL can't be read", () => {
    assert.equal(analyticsUrl("not a url"), null);
    assert.equal(analyticsUrl(""), null);
  });
});
