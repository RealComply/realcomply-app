"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { PropertyItem } from "@/lib/types";

// The advertised-price check.
//
// Reads the agency's own live listing page and compares the price actually
// advertised against the ESP recorded on the file.
//
// WHY THIS EXISTS WHEN c1 ALREADY CHECKS THE GUIDE. c1 records what the agent
// says is advertised and checks that against the ESP. It cannot catch the two
// failures that actually happen: the ESP gets revised and the advertising is
// never updated (s73(3) requires amendment "as soon as practicable"), or what
// went live is not what was recorded. Those need someone to look at the page.
//
// NOT A LEGAL REQUIREMENT, AND THE CODE SHOULD NOT PRETEND IT IS. Nothing in
// the Act obliges an agent to review advertising on any schedule. This is a
// precaution the agency chooses, and its value is s73A(1A): an agent is liable
// for what their people advertise, with a defence where they "took all
// reasonable precautions". A systematic automated check is evidence of exactly
// that. See §2.5.6 of the Cass Supervision Guidelines for the wording that
// followed from the same reasoning.
//
// DIVISION OF LABOUR, same as everywhere else in this app: the model reads the
// page and reports what it sees; the comparison against the ESP is arithmetic
// done in code. A model asked "is this underquoting?" would sometimes be wrong
// and could never be audited. Subtraction cannot be wrong.

export type ScanFinding = {
  checkedAt: string;
  url: string;
  ok: boolean;
  /**
   * Whether the page itself showed this property's address.
   *
   * This is what replaced asking the agent to confirm the page once, by hand
   * (Adam, 16 Aug 2026: a button they have to press "may as well just eyeball
   * their own website"). The danger in finding the page automatically is a
   * wrong match producing a silent all-clear. Corroborating against the address
   * printed on the page removes that without costing anyone a click: an
   * unconfirmed page never produces a clean result and never flags an item.
   */
  addressConfirmed: boolean;
  /** Plain-English outcome shown on the card. */
  summary: string;
  /** Specific breaches or concerns, each traceable to a section. */
  issues: string[];
  priceShown: boolean;
  priceText?: string;
  priceLow?: number;
  priceHigh?: number;
};

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_advertised_price",
  description:
    "Record the price as advertised on this listing page, exactly as a member of the public would read it. Report only what is on the page.",
  input_schema: {
    type: "object",
    properties: {
      priceShown: {
        type: "boolean",
        description:
          "True only if the page shows a price, price range or price guide for this property. 'Contact agent', 'Auction', 'Price on application' and similar are NOT a price — report false.",
      },
      priceText: {
        type: "string",
        description: "The price exactly as written on the page, e.g. '$1,200,000 - $1,300,000' or 'Contact agent'.",
      },
      priceLow: {
        type: "number",
        description: "The lower figure as a number, no symbols or separators. Omit if no numeric price is shown.",
      },
      priceHigh: {
        type: "number",
        description: "The upper figure. For a single price, set the same value as priceLow. Omit if no numeric price is shown.",
      },
      prohibitedTerms: {
        type: "array",
        items: { type: "string" },
        description:
          "Any of these phrasings appearing with the price: 'offers over', 'offers above', 'offers from', 'o.n.o.', or a plus sign after a figure (e.g. '$900,000+'). Quote them as they appear. Empty array if none.",
      },
      pageLooksWrong: {
        type: "boolean",
        description:
          "True if this does not look like a property listing page at all — an error page, a search results page, or a page that failed to load properly.",
      },
      addressMatches: {
        type: "boolean",
        description:
          "True ONLY if the page itself shows an address that is clearly the same property as the one named in the request. This is the safety check on the whole result: if the page does not state an address, or states a different one, report false. Do not infer a match from the page merely being on the right website.",
      },
    },
    required: ["priceShown", "prohibitedTerms", "pageLooksWrong", "addressMatches"],
  },
};

/**
 * Rejects anything that is not a plain public https URL.
 *
 * The URL is supplied by a user and fetched by our server, which is the classic
 * shape of a server-side request forgery: left unchecked, someone could point a
 * listing at an internal address and use our infrastructure to reach it. Cloud
 * metadata endpoints are the usual target, hence the explicit block on the
 * link-local range as well as the private ones.
 */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid web address.");
  }

  if (url.protocol !== "https:") {
    throw new Error("The listing address must start with https://");
  }

  const host = url.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host === "[::1]" ||
    host === "0.0.0.0";

  if (isPrivate) {
    throw new Error("That address can't be checked.");
  }

  return url;
}

/** HTML to something a model can read. No parser dependency for one job. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20000);
}

async function readListingPage(url: URL): Promise<string> {
  // A listing page that hangs should fail the check, not the whole weekly run.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Identifies us honestly. A site owner reading their logs should be
        // able to tell who this is, and it is the agency's own website.
        "User-Agent": "RealComply-AdvertisedPriceCheck/1.0 (+https://www.realcomply.com.au)",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`The page returned ${res.status}.`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * Runs the check for one property and records the finding on c1.
 *
 * Writes to data.websiteScan and never touches guideLow/guideHigh or the
 * item's status. The agent's own record of the advertised guide is theirs; a
 * scraped page must not silently overwrite it, and an automated read must not
 * flag a file on its own — a mis-parsed page would put a red mark on a
 * compliant listing. It reports; the agent decides.
 */
export async function scanOneProperty(
  supabase: Db,
  anthropic: Anthropic,
  property: { id: string; agency_id: string; address: string; listing_url: string | null },
): Promise<ScanFinding | null> {
  if (!property.listing_url) return null;

  const checkedAt = new Date().toISOString();
  const base = { checkedAt, url: property.listing_url, priceShown: false, addressConfirmed: false };

  let finding: ScanFinding;

  try {
    const url = assertSafeUrl(property.listing_url);
    const text = toText(await readListingPage(url));

    if (text.length < 200) {
      finding = { ...base, ok: false, summary: "Couldn't read that page — there was almost nothing on it.", issues: [] };
    } else {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 400,
        system:
          "You read a real estate listing page and report the advertised price exactly as a member of the public " +
          "would see it. Report only what is on the page. Never infer a price from anything other than a price " +
          "displayed for this property, and never carry over a figure from another listing shown on the same page.",
        messages: [
          {
            role: "user",
            content: `Listing page for ${property.address}.\n\n${text}`,
          },
        ],
        tools: [EXTRACTION_TOOL],
        tool_choice: { type: "tool", name: "record_advertised_price" },
      });

      const toolUse = response.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      const read = (toolUse?.input ?? {}) as {
        priceShown?: boolean;
        priceText?: string;
        priceLow?: number;
        priceHigh?: number;
        prohibitedTerms?: string[];
        pageLooksWrong?: boolean;
        addressMatches?: boolean;
      };

      // The ESP to compare against, read from the file rather than the page.
      const { data: espRow } = await supabase
        .from("property_items")
        .select("data")
        .eq("property_id", property.id)
        .eq("item_key", "a4")
        .maybeSingle();
      const esp = ((espRow as PropertyItem | null)?.data ?? {}) as { espLow?: number };

      const issues: string[] = [];

      const addressConfirmed = Boolean(read.addressMatches) && !read.pageLooksWrong;

      // An unconfirmed page produces no verdict at all — neither a clean result
      // nor a breach. Everything below this point assumes we are looking at the
      // right property, and reporting either way on a page we cannot tie to the
      // address is how an automated check quietly misleads someone.
      if (!addressConfirmed) {
        const unconfirmed: ScanFinding = {
          ...base,
          addressConfirmed: false,
          ok: false,
          priceShown: Boolean(read.priceShown),
          priceText: read.priceText,
          issues: [],
          summary:
            "Couldn't confirm this page is for this property, so nothing was checked. Open it and, if it's wrong, set the right link in Edit listing details.",
        };
        await writeFinding(supabase, property, unconfirmed);
        return unconfirmed;
      }

      // Arithmetic, not judgement.
      if (read.priceLow != null && esp.espLow != null && read.priceLow < esp.espLow) {
        issues.push(
          `Advertised price starts at $${read.priceLow.toLocaleString("en-AU")}, below the ESP of $${esp.espLow.toLocaleString("en-AU")} on this file (s73(1)). If the ESP was revised, s73(3) requires the advertising to be amended as soon as practicable.`,
        );
      }
      if (read.priceLow != null && read.priceHigh != null && read.priceLow > 0) {
        const spread = ((read.priceHigh - read.priceLow) / read.priceLow) * 100;
        if (spread > 10) {
          issues.push(`Advertised range spreads ${spread.toFixed(1)}%, more than the 10% allowed (s72A(2)).`);
        }
      }
      for (const term of read.prohibitedTerms ?? []) {
        issues.push(`Advertising uses “${term}”, which s73(2) prohibits.`);
      }
      if (read.priceShown && esp.espLow == null) {
        issues.push("No ESP recorded on this file to check the advertised price against.");
      }

      finding = {
        ...base,
        addressConfirmed,
        ok: issues.length === 0,
        priceShown: Boolean(read.priceShown),
        priceText: read.priceText,
        priceLow: read.priceLow,
        priceHigh: read.priceHigh,
        issues,
        summary: issues.length
          ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at on the live ad.`
          : read.priceShown
            ? `Advertised at ${read.priceText ?? "the recorded guide"}, consistent with the ESP on file.`
            : "No price shown on the listing page. Nothing to check against the ESP.",
      };
    }
  } catch (err) {
    finding = {
      ...base,
      ok: false,
      issues: [],
      summary: `Couldn't check the live ad: ${err instanceof Error ? err.message : "the page couldn't be reached"}`,
    };
  }

  await writeFinding(supabase, property, finding);
  return finding;
}

/**
 * Records a finding on c1.
 *
 * Never touches guideLow/guideHigh — the agent's own record of the advertised
 * guide is theirs, and a page read must not overwrite it.
 *
 * DOES set the item to flagged, but only where the page was confirmed to be
 * this property and the arithmetic found a breach. Adam, 16 Aug 2026: the point
 * is that RealComply "routinely check the website and come back to the agent
 * and let them know if their advertised price has slipped below the ESP" —
 * a finding nobody is told about is not a check. Flagging is what puts it in
 * front of them, on Office overview and in the Monday digest, without anyone
 * opening the file.
 *
 * The flag is only ever raised, never cleared: an agent who has resolved
 * something and marked the item done should not have it silently reopened by
 * next Sunday's run while they are looking the other way.
 */
async function writeFinding(
  supabase: Db,
  property: { id: string; agency_id: string },
  finding: ScanFinding,
): Promise<void> {
  const { data: existing } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", property.id)
    .eq("item_key", "c1")
    .maybeSingle();
  const row = existing as PropertyItem | null;

  const shouldFlag = finding.addressConfirmed && finding.issues.length > 0;

  await supabase.from("property_items").upsert(
    {
      agency_id: property.agency_id,
      property_id: property.id,
      item_key: "c1",
      status: shouldFlag ? "flagged" : row?.status ?? "open",
      data: { ...(row?.data ?? {}), websiteScan: finding },
      event_date: row?.event_date ?? null,
      completed_by: row?.completed_by ?? null,
      evidence_path: row?.evidence_path ?? null,
    },
    { onConflict: "property_id,item_key" },
  );
}

/** The agent's "check it now" button. */
export async function checkListingNow(propertyId: string): Promise<{ error: string | null }> {
  const { supabase } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "The advertised-price check isn't set up yet — ANTHROPIC_API_KEY is missing." };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, agency_id, address, listing_url")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) return { error: "Couldn't find that property." };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const p = property as { id: string; agency_id: string; address: string; listing_url: string | null };

  // Same path as the weekly run: find the page if we do not have one yet.
  let url = p.listing_url;
  if (!url) {
    url = await discoverListingUrl(supabase, anthropic, p);
    if (!url) {
      return {
        error:
          "Couldn't find this listing on your website. If it's published, paste the link in Edit listing details; if it isn't yet, there's nothing to check.",
      };
    }
  }

  await scanOneProperty(supabase, anthropic, { ...p, listing_url: url });

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * The weekly sweep, for the cron route.
 *
 * Service-role client: there is no logged-in user on a scheduled run, same
 * reasoning as the weekly digest. Only reaches listings that are on market or
 * later and have a URL, because a listing not yet advertised has no
 * advertisement to check.
 */
export async function runWeeklyListingScan(): Promise<{ checked: number; withIssues: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { checked: 0, withIssues: 0 };

  const supabase = createServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Every on-market listing, not only the ones already linked to a page. A
  // listing with no page recorded gets one found for it first — that is the
  // whole point of doing this on a schedule rather than behind a button.
  const { data: rows } = await supabase
    .from("properties")
    .select("id, agency_id, address, listing_url, stage")
    .gte("stage", 2)
    .lte("stage", 4);

  const properties = (rows ?? []) as Array<{
    id: string;
    agency_id: string;
    address: string;
    listing_url: string | null;
  }>;

  const db = supabase as unknown as Db;
  let checked = 0;
  let withIssues = 0;

  for (const property of properties) {
    // Sequential rather than parallel. A dozen listings a week is not worth
    // hammering an agency's own website with concurrent requests.
    let url = property.listing_url;
    if (!url) {
      url = await discoverListingUrl(db, anthropic, property);
      if (!url) continue; // not published yet, or not findable — try again next week
    }

    const finding = await scanOneProperty(db, anthropic, { ...property, listing_url: url });
    if (finding) {
      checked += 1;
      if (!finding.ok) withIssues += 1;
    }
  }

  return { checked, withIssues };
}

// ── Finding the listing page ───────────────────────────────────────────────
//
// Pasting a URL per listing is the kind of unnecessary work this product exists
// to remove (Adam, 16 Aug 2026). With the agency's website recorded once, the
// app goes and finds the page itself.
//
// CONFIRM ONCE, THEN IT IS A FACT. Matching an address to a link is inference,
// and a check that silently matched the wrong page would report a clean result
// for a listing nobody looked at — the worst failure available to this feature,
// because it is invisible. So discovery proposes; the agent confirms; the exact
// URL is then stored on the property and never guessed again.
//
// SAME HOST ONLY, and at most one hop from the site's own pages. This is a
// server fetching a URL chosen by a model reading a web page, which is a short
// route to fetching something nobody intended. Constraining candidates to the
// agency's own domain keeps the model's choice inside the set of pages the
// agency already publishes.

export type ListingCandidate = { url: string; label: string; why: string };

const LINK_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

/** Same-host links with their anchor text, deduplicated, capped. */
function linksFrom(html: string, base: URL): Array<{ href: string; text: string }> {
  const seen = new Set<string>();
  const out: Array<{ href: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(html)) !== null) {
    let abs: URL;
    try {
      abs = new URL(m[1], base);
    } catch {
      continue;
    }
    if (abs.protocol !== "https:" || abs.hostname !== base.hostname) continue;
    abs.hash = "";
    const key = abs.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    out.push({ href: key, text });
    if (out.length >= 400) break;
  }
  return out;
}

const CANDIDATE_TOOL: Anthropic.Tool = {
  name: "choose_listing_page",
  description:
    "Pick the link most likely to be this property's own listing page, or the link most likely to be the agency's for-sale index if the listing itself is not in this list.",
  input_schema: {
    type: "object",
    properties: {
      listingUrl: {
        type: "string",
        description: "The link that is this property's own listing page. Omit if none of the links is clearly that page.",
      },
      indexUrl: {
        type: "string",
        description:
          "The link most likely to be the agency's for-sale / current-listings index, to look at next. Omit if the listing itself was found or no such index is present.",
      },
      why: {
        type: "string",
        description: "One short sentence on why this link matches the address, for the agent to sanity-check.",
      },
    },
    required: [],
  },
};

/**
 * Finds and stores this property's listing page, from the agency's website.
 *
 * Runs automatically as part of the weekly check for any on-market listing that
 * has no page recorded yet. There is deliberately no button for this.
 *
 * Adam, 16 Aug 2026: a "find the listing page" button is "another step that the
 * agent has to do ... may as well just eyeball their own website. The whole
 * point of this is for RealComply to routinely check the website and come back
 * to the agent and let them know if their advertised price has slipped below
 * the ESP." A check the agent has to set up per listing is not a check that
 * happens.
 *
 * What replaced the confirmation step is corroboration: whatever page this
 * finds, the scan only reports on it if the page itself shows this property's
 * address. A wrong match therefore produces "couldn't confirm this page",
 * never a false all-clear. See addressConfirmed on ScanFinding.
 *
 * Returns null when nothing convincing was found, which is a normal outcome —
 * a listing not yet published has no page, and next week it will.
 */
async function discoverListingUrl(
  supabase: Db,
  anthropic: Anthropic,
  property: { id: string; agency_id: string; address: string },
): Promise<string | null> {
  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("website_url")
    .eq("id", property.agency_id)
    .maybeSingle();
  const website = (agencyRow as { website_url?: string | null } | null)?.website_url;
  if (!website) return null;

  try {
    let current = assertSafeUrl(website);

    // Two passes at most: the site's own page, then one index it points at.
    // Anything deeper is a crawl, and a crawl of someone's website is not a
    // thing to start doing quietly on a weekly schedule.
    for (let hop = 0; hop < 2; hop++) {
      const html = await readListingPage(current);
      const links = linksFrom(html, current);
      if (links.length === 0) return null;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-5",
        max_tokens: 300,
        system:
          "You match a property address to the correct link on a real estate agency's own website. Choose only " +
          "from the links given. If no link clearly corresponds to that specific property, say nothing rather " +
          "than choosing the closest one — a wrong match is worse than no match here.",
        messages: [
          {
            role: "user",
            content:
              `Property: ${property.address}\n\nLinks on ${current.toString()}:\n` +
              links.map((l) => `${l.href} — ${l.text}`).join("\n"),
          },
        ],
        tools: [CANDIDATE_TOOL],
        tool_choice: { type: "tool", name: "choose_listing_page" },
      });

      const toolUse = response.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      const choice = (toolUse?.input ?? {}) as { listingUrl?: string; indexUrl?: string };

      // Only ever accept a link that was actually in the list we supplied.
      const known = new Set(links.map((l) => l.href));

      if (choice.listingUrl && known.has(choice.listingUrl)) {
        await supabase.from("properties").update({ listing_url: choice.listingUrl }).eq("id", property.id);
        return choice.listingUrl;
      }
      if (choice.indexUrl && known.has(choice.indexUrl)) {
        current = new URL(choice.indexUrl);
        continue;
      }
      return null;
    }
    return null;
  } catch {
    // A website that cannot be read is next week's problem, not an error the
    // agent needs to see — they did not ask for this to run.
    return null;
  }
}
