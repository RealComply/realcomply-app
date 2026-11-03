import { sydneyDate } from "@/lib/subscription-end/dates";
import { formatAuDate } from "@/lib/format-date";

// AN AGENT'S OWN LISTINGS PAGE FOR THE DAILY PRICE CHECK (Adam, 2 Nov 2026;
// approved 9 Oct 2026 in the code review brief, part D2; database 0105).
//
// Was: the 7am check found each listing's web page from the office's listings
// page only (agencies.website_url). It had not found a page for any listing
// outside Cass Property and Uralla Properties; two Raine & Horne listings went
// from On market to Sold with no price check.
// Now: each person who lists properties can add their own page on the office
// website ("My listings page", often their agent profile). The check looks
// there first for that agent's listings, then on the office page.
//
// This file holds the rules with no database or network in them: the order
// the pages are tried in, the line under each page's field after the morning's
// check, and the group-page warning. The fetching and reading are in
// lib/actions/website-scan.ts.

export type PageKind = "agent" | "office";
export type ListingsPage = { kind: PageKind; url: string };

/**
 * The pages to look in for one listing, in order: the listing agent's own
 * page, then the office page. The same address twice is looked at once.
 *
 * Co-agent (queue item 6) isn't built yet. When it is, the co-agent's own
 * page goes after the lead agent's and before the office page (Adam, 2 Nov
 * 2026: "check both agents' pages").
 */
export function pagesToTry(agentPage: string | null | undefined, officePage: string | null | undefined): ListingsPage[] {
  const pages: ListingsPage[] = [];
  if (agentPage) pages.push({ kind: "agent", url: agentPage });
  if (officePage && officePage !== agentPage) pages.push({ kind: "office", url: officePage });
  return pages;
}

/**
 * What one look at a page came to. found: the listing's own link was on it.
 * no_match: listings were there, none of them this property. no_links: the
 * page as sent had no links to choose from (often a page that draws its
 * listings in after it loads). refused: the website turned the check away,
 * or the address can't be fetched. failed: the reader itself failed.
 */
export type SearchResult = "found" | "no_match" | "no_links" | "refused" | "failed";
export type SearchTry = { page: PageKind; result: SearchResult };

/** Each page in turn until one has the listing. Every look is kept, so why a page wasn't found is on record. */
export async function findOnPages(
  pages: ListingsPage[],
  look: (page: ListingsPage) => Promise<{ url: string | null; result: SearchResult }>,
): Promise<{ url: string | null; tries: SearchTry[] }> {
  const tries: SearchTry[] = [];
  for (const page of pages) {
    const { url, result } = await look(page);
    tries.push({ page: page.kind, result });
    if (url) return { url, tries };
  }
  return { url: null, tries };
}

const SEARCH_WORDS: Record<Exclude<SearchResult, "found">, string> = {
  no_match: "the listings on it didn't include this property",
  no_links: "the page had no links to listings that RealComply could read",
  refused: "the website turned RealComply's check away",
  failed: "RealComply's reader failed",
};

/**
 * One line for the listing, when its page hasn't been found: where the
 * morning's check looked and what each page came to. Null when nothing was
 * looked at, or the page was found.
 */
export function searchLine(search: { at: string; tries: SearchTry[] } | null | undefined): string | null {
  if (!search || search.tries.length === 0 || search.tries.some((t) => t.result === "found")) return null;
  const parts = search.tries.map(
    (t) =>
      `${t.page === "agent" ? "the agent's own listings page" : "the office listings page"}: ${
        SEARCH_WORDS[t.result as Exclude<SearchResult, "found">]
      }`,
  );
  return `This listing's page wasn't found on ${formatAuDate(sydneyDate(new Date(search.at)))}. Looked at ${parts.join("; ")}.`;
}

/** What a page showed at the morning's check (listings_page_checks, 0105). */
export type PageCheck = {
  pageKey: string;
  url: string;
  checkedAt: string;
  outcome: "read" | "refused" | "failed";
  listingsFound: number | null;
  inRealcomply: number | null;
  keptUrl: string | null;
};

/** The database row, as the app reads it. */
export function pageCheckFrom(row: Record<string, unknown> | null | undefined): PageCheck | null {
  if (!row || typeof row.page_key !== "string" || typeof row.url !== "string") return null;
  return {
    pageKey: row.page_key,
    url: row.url,
    checkedAt: String(row.checked_at),
    outcome: (row.outcome as PageCheck["outcome"]) ?? "failed",
    listingsFound: typeof row.listings_found === "number" ? row.listings_found : null,
    inRealcomply: typeof row.in_realcomply === "number" ? row.in_realcomply : null,
    keptUrl: typeof row.kept_url === "string" ? row.kept_url : null,
  };
}

const listings = (n: number) => `${n} ${n === 1 ? "listing" : "listings"}`;

/**
 * The line under a listings page field after the morning's check (Adam,
 * 2 Nov 2026): "Checked this morning: [n] listings found, [n] in RealComply".
 * An earlier day's check says which day. A page not checked yet, or changed
 * since, says when it will be.
 */
export function checkLine(check: PageCheck | null | undefined, currentUrl: string | null | undefined, now = new Date()): string | null {
  if (!currentUrl) return null;
  if (!check || check.url !== currentUrl) return "Not checked yet. RealComply checks it each morning at 7am.";
  const day = sydneyDate(new Date(check.checkedAt));
  const when = day === sydneyDate(now) ? "Checked this morning" : `Last checked ${formatAuDate(day)}`;
  if (check.outcome === "refused") {
    return `${when}: the website turned RealComply's check away, so no listings could be read from this page.`;
  }
  if (check.outcome === "failed" || check.listingsFound === null) {
    return `${when}: RealComply couldn't read this page. It will try again tomorrow morning.`;
  }
  return `${when}: ${listings(check.listingsFound)} found, ${check.inRealcomply ?? 0} in RealComply`;
}

/** More than this many times as many listings as in RealComply reads as a group's page. */
export const GROUP_PAGE_FACTOR = 3;
/**
 * And at least this many listings on the page (Adam asked for a cut-off, 3 Nov
 * 2026). An agent's own profile often shows a few listings from before they
 * joined RealComply: 7 on the page against 2 in RealComply is not a group's
 * page. A group's page shows dozens or hundreds (184 in the mockup).
 */
export const GROUP_PAGE_MIN_LISTINGS = 20;

/**
 * The group-page warning (Adam, 2 Nov 2026): the page showed at least 20
 * listings, and more than three times as many as that agent (or office) has
 * in RealComply. Not while they have none in RealComply: there is nothing to
 * match yet, so nothing a big page could match wrongly, and every new office
 * starts at none. Not once "Keep this one" was pressed for this address.
 */
export function groupWarning(
  check: PageCheck | null | undefined,
  currentUrl: string | null | undefined,
): { found: number; inRealcomply: number } | null {
  if (!check || !currentUrl || check.url !== currentUrl || check.outcome !== "read") return null;
  const found = check.listingsFound ?? 0;
  const inRealcomply = check.inRealcomply ?? 0;
  if (inRealcomply < 1 || found < GROUP_PAGE_MIN_LISTINGS || found <= GROUP_PAGE_FACTOR * inRealcomply) return null;
  if (check.keptUrl === currentUrl) return null;
  return { found, inRealcomply };
}

/** Adam's words, 2 Nov 2026. */
export function groupWarningText(w: { found: number; inRealcomply: number }): string {
  return (
    `This page may be the whole group's. This morning it showed ${listings(w.found)}, but you have ${w.inRealcomply} in RealComply. ` +
    "Checking a page this size is slower and more likely to match the wrong property. If you have your own page, use that instead."
  );
}

/** The help text under "My listings page", and "Your listings page" when an invited agent joins (Adam, 2 Nov 2026). */
export const MY_LISTINGS_PAGE_HELP =
  "If you have your own page on the office website (often your agent profile), add it here. RealComply checks it first for your listings. Leave it blank to use the office page.";

/** "Your listings page" when an agent signs up on their own plan (Adam, 3 Nov 2026; approved mockup). */
export const OWN_PLAN_PAGE_HELP =
  "Your own page on your agency's website, often your agent profile. RealComply checks it each morning for your listings and their advertised prices.";

/** The link under it that opens the agency's page (Adam, 3 Nov 2026). */
export const ADD_AGENCY_PAGE = "+ Add your agency's listings page too";

/** "Your office's listings page" when an office signs up (Adam, 3 Nov 2026; approved mockup). */
export const OFFICE_PAGE_SIGNUP_HELP =
  "The page on your website that shows the properties you have for sale right now. Part of a group? Use your own office's page, not the group's home page. Your agents can add their own pages when they join.";

/** "Your current listings page" on the Office profile (approved mockup, 3 Nov 2026). */
export const OFFICE_PAGE_HELP = "The page on your website that shows the properties you have for sale right now.";

/**
 * Adam, 3 Nov 2026: "the price check only runs when there is a page to
 * check. If an agent has no page of their own and there is no office page,
 * don't scan for them."
 */
export function priceCheckOn(agentPage: string | null | undefined, officePage: string | null | undefined): boolean {
  return Boolean(agentPage || officePage);
}

/** On My details, the Office profile and the listing, while there is no page (Adam, 3 Nov 2026). */
export const PRICE_CHECK_OFF = "Price check is off. Add your listings page to turn it on.";

/** The help text on the Office profile card (Adam, 2 Nov 2026). */
export const AGENTS_PAGES_HELP =
  "If an agent has their own page, RealComply checks it first for that agent's listings. Agents can add their own; you can add or change anyone's.";

export const NOT_SET_LINE = "Not set. Uses the office page.";
