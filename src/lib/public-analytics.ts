// What Vercel Web Analytics is allowed to record about a page view on the
// public website (Adam, 29 Oct 2026): the page, and the ?src= channel tag
// (?src=sms1, ?src=email1) so we can see which channel brought a visit.
// Nothing else from the URL. Every other query value and any #fragment is
// dropped, because a link can carry anything someone typed into it.
//
// The src value itself is kept only while it looks like one of our channel
// tags: letters, digits, dots, dashes and underscores, up to 40 characters.
// Anything else (an email address, a sentence) is dropped rather than
// recorded, and the visit is still counted against the page.
//
// Only the public pages below are ever recorded. Once loaded, Vercel's
// script stays in the browser tab when someone clicks through to sign in and
// on into the app, so any event for another page is refused here (null)
// rather than trusting it never to fire. A new public page goes in this list
// as well as getting <PublicAnalytics /> on it.
//
// Returns null when the URL cannot be read, which tells Vercel not to send
// the event at all. Failing closed means an odd URL is never recorded whole.

export const PUBLIC_PAGES = new Set(["/", "/privacy", "/terms", "/dpa"]);

const SRC_TAG = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * The URL to record for an analytics event.
 *
 * `pageUrl` is the address bar at the moment the event is sent. It is only a
 * fallback for the src tag, used when the event's own URL arrives without a
 * query string, and only when both point at the same page.
 */
export function analyticsUrl(eventUrl: string, pageUrl?: string): string | null {
  let url: URL;
  try {
    url = new URL(eventUrl);
  } catch {
    return null;
  }
  if (!PUBLIC_PAGES.has(url.pathname)) return null;

  let src = url.searchParams.get("src");
  if (src === null && pageUrl) {
    try {
      const page = new URL(pageUrl);
      if (page.origin === url.origin && page.pathname === url.pathname) src = page.searchParams.get("src");
    } catch {
      // No usable page address: record the page without a tag.
    }
  }

  const tag = src !== null && SRC_TAG.test(src) ? `?src=${src}` : "";
  return `${url.origin}${url.pathname}${tag}`;
}
