import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeChallenge, requestAllowed } from "@/lib/listing-scan/render-rules";

// The headless fallback's rules (Adam, 11 Nov 2026; listings page check fix 3).

test("never past 'checking your browser': a challenge or refusal is seen, and left there", () => {
  assert.equal(looksLikeChallenge(403, "Forbidden", ""), true);
  assert.equal(looksLikeChallenge(503, "", ""), true);
  assert.equal(looksLikeChallenge(200, "Just a moment...", ""), true);
  assert.equal(looksLikeChallenge(200, "example.invalid", "Checking your browser before accessing example.invalid"), true);
  assert.equal(looksLikeChallenge(200, "Attention Required! | Cloudflare", ""), true);
  assert.equal(looksLikeChallenge(200, "", "Please verify you are human to continue"), true);
  assert.equal(looksLikeChallenge(200, "Properties | Yes Property Agents (made up)", "For sale. 12 listings"), false);
  assert.equal(looksLikeChallenge(null, "Properties", ""), false);
});

test("what the browser may fetch while drawing the page", () => {
  const start = new URL("https://www.example-agency.invalid/Properties");
  const req = (url: string, over: Partial<{ resourceType: string; isNavigation: boolean; isMainFrame: boolean }> = {}) =>
    requestAllowed({ url, resourceType: "script", isNavigation: false, isMainFrame: true, ...over }, start);
  assert.equal(req("https://www.example-agency.invalid/app.js"), true);
  assert.equal(req("https://api.some-app-host.invalid/entities/Listing", { resourceType: "fetch" }), true, "the page's own data, wherever it's kept");
  assert.equal(req("data:text/javascript,1"), true);
  assert.equal(req("http://www.example-agency.invalid/app.js"), false, "https only");
  assert.equal(req("https://www.example-agency.invalid:8443/app.js"), false, "the normal port only");
  assert.equal(req("https://user:pw@www.example-agency.invalid/"), false);
  assert.equal(req("file:///etc/passwd"), false);
  assert.equal(req("https://cdn.invalid/photo.jpg", { resourceType: "image" }), false, "pictures draw nothing the check reads");
  assert.equal(req("https://cdn.invalid/font.woff2", { resourceType: "font" }), false);
  assert.equal(req("https://example-agency.invalid/Properties", { resourceType: "document", isNavigation: true }), true, "the same website, www or not");
  assert.equal(req("https://elsewhere.invalid/", { resourceType: "document", isNavigation: true }), false, "the page may not go to another website");
  assert.equal(req("https://maps.invalid/embed", { resourceType: "document", isNavigation: true, isMainFrame: false }), true, "a frame inside it may load");
  assert.equal(req("not a url"), false);
});
