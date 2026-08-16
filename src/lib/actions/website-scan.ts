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
          "True if this does not look like a property listing page at all — an error page, a search results page, a page for a different property, or a page that failed to load properly.",
      },
    },
    required: ["priceShown", "prohibitedTerms", "pageLooksWrong"],
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
  const base = { checkedAt, url: property.listing_url, priceShown: false };

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

      if (read.pageLooksWrong) {
        issues.push("That address doesn't look like this property's listing page — check the link.");
      }

      // Arithmetic, not judgement.
      if (read.priceLow != null && esp.espLow != null && read.priceLow < esp.espLow) {
        issues.push(
          `Advertised price starts at $${read.priceLow.toLocaleString("en-AU")}, below the recorded ESP of $${esp.espLow.toLocaleString("en-AU")} (s73(1)).`,
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

  const { data: existing } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", property.id)
    .eq("item_key", "c1")
    .maybeSingle();
  const row = existing as PropertyItem | null;

  await supabase.from("property_items").upsert(
    {
      agency_id: property.agency_id,
      property_id: property.id,
      item_key: "c1",
      status: row?.status ?? "open",
      data: { ...(row?.data ?? {}), websiteScan: finding },
      event_date: row?.event_date ?? null,
      completed_by: row?.completed_by ?? null,
      evidence_path: row?.evidence_path ?? null,
    },
    { onConflict: "property_id,item_key" },
  );

  return finding;
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
  if (!(property as { listing_url: string | null }).listing_url) {
    return { error: "Add the listing's web address in Edit listing details first." };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  await scanOneProperty(supabase, anthropic, property as Parameters<typeof scanOneProperty>[2]);

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

  const { data: rows } = await supabase
    .from("properties")
    .select("id, agency_id, address, listing_url, stage")
    .not("listing_url", "is", null)
    .gte("stage", 2)
    .lte("stage", 4);

  const properties = (rows ?? []) as Array<{
    id: string;
    agency_id: string;
    address: string;
    listing_url: string | null;
  }>;

  let withIssues = 0;
  for (const property of properties) {
    // Sequential rather than parallel. A dozen listings a week is not worth
    // hammering an agency's own website with concurrent requests.
    const finding = await scanOneProperty(supabase as unknown as Db, anthropic, property);
    if (finding && !finding.ok) withIssues += 1;
  }

  return { checked: properties.length, withIssues };
}
