"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { analyticsUrl } from "@/lib/public-analytics";

/**
 * Vercel Web Analytics: PUBLIC WEBSITE PAGES ONLY (Adam, 29 Oct 2026).
 *
 * Rendered by the landing page and the legal pages (/privacy, /terms, /dpa),
 * and nowhere else. Like MetaPixel.tsx, it must never go in a shared layout
 * the signed-in app sits under: page views inside the compliance app are not
 * something we send to an analytics service. If a new public page is added,
 * add this component to it explicitly, and its path to PUBLIC_PAGES.
 *
 * No cookies. Each page view records only the page and the ?src= channel tag,
 * and a page that isn't public is never recorded even if the script is still
 * loaded (see lib/public-analytics.ts). It draws nothing on the page. It
 * replaced Plausible, which was removed with it. The Meta pixel is unchanged.
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = analyticsUrl(event.url, window.location.href);
  return url ? { ...event, url } : null;
}

export function PublicAnalytics() {
  return <Analytics beforeSend={beforeSend} />;
}
