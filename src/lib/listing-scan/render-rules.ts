// THE HEADLESS FALLBACK'S RULES (Adam, 11 Nov 2026, through Master; listings
// page check fix 3 of 3). Kept apart from the browser so they can be tested
// without one. The browser itself is in render-page.ts.
//
// Only a page whose plain read and data read both found 0 listings is opened
// in a browser, once, and waited on until it has drawn. Then the same rules as
// any read: this website only, the page treated as data, the AI counts.
//
// NEVER PAST "CHECKING YOUR BROWSER" (Adam). A website that answers the
// browser with a challenge, a block or an error is left there: nothing is
// waited out, solved, disguised or tried again. The browser says what it is
// (Chrome's own headless name), as the plain read does.

import { sameWebsite } from "@/lib/listing-scan/pages-scan";

/** How long one page may take: to open, then to finish drawing. */
export const OPEN_TIMEOUT_MS = 20_000;
export const SETTLE_TIMEOUT_MS = 10_000;
/** Drawn when the page's links have stayed the same for this many looks, this far apart (1.5 seconds). */
export const STEADY_POLLS = 3;
export const POLL_MS = 500;
/** Requests one page may make, all told. A listings page needs far fewer. */
export const MAX_REQUESTS = 250;
/** The drawn page is read like the plain one: its first 3 MB. */
export const MAX_HTML_CHARS = 3 * 1024 * 1024;

const CHALLENGE = [
  /just a moment/i,
  /checking (if the site connection is secure|your browser)/i,
  /attention required/i,
  /verify (that )?you are (a )?human/i,
  /are you a robot/i,
  /access denied/i,
  /enable javascript and cookies to continue/i,
  /ddos protection by/i,
  /captcha/i,
];

/**
 * Whether what the browser got is a challenge or a refusal rather than the
 * page: an error status, or a page that says it is checking the visitor.
 * Looked at once, as it first arrives. Never waited out.
 */
export function looksLikeChallenge(status: number | null, title: string, text: string): boolean {
  if (status !== null && status >= 400) return true;
  const head = `${title}\n${text.slice(0, 2000)}`;
  return CHALLENGE.some((re) => re.test(head));
}

export type RequestSeen = { url: string; resourceType: string; isNavigation: boolean; isMainFrame: boolean };

/**
 * What the browser may fetch while drawing the page. https only (and data
 * the page holds itself); no pictures, video or fonts, which draw nothing
 * the check reads; and the page itself may not go to another website.
 * Whether a website's address is a public one is checked separately, by DNS,
 * as for the plain read.
 */
export function requestAllowed(req: RequestSeen, start: URL): boolean {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return false;
  }
  if (url.protocol === "data:") return true;
  if (url.protocol !== "https:") return false;
  if (url.port !== "" || url.username !== "" || url.password !== "") return false;
  if (["image", "media", "font", "websocket", "eventsource", "manifest"].includes(req.resourceType)) return false;
  if (req.isNavigation && req.isMainFrame && !sameWebsite(url.hostname, start.hostname)) return false;
  return true;
}
