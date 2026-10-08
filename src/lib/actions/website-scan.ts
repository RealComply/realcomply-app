"use server";

import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAuthContext } from "@/lib/actions/compliance";
import { effectiveEsp, espLabel } from "@/lib/data/effective-esp";
import { sendListingAlert, type RedFlag } from "@/lib/email/listing-price-alert";
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
  prohibitedTerms?: string[];
  /**
   * sha256 of the price area of the page as read on this check — the text
   * around every figure and price word. Tomorrow's check compares against it.
   */
  priceAreaHash?: string;
  /** When the model last actually read the page. Equal to checkedAt on a full read. */
  readAt?: string;
  /**
   * True when the page's price area was the same as at the last read, so the
   * previous read was reused and no model call was made. The check still ran:
   * the page was fetched, compared, and the arithmetic redone against the ESP
   * on file today.
   */
  aiSkipped?: boolean;
  /** Tokens spent on this check's model read. Absent when aiSkipped. */
  usage?: { inputTokens: number; outputTokens: number };
  /**
   * The issues that email the agent: no price showing, or a price below the
   * ESP. Each is also in issues. See lib/email/listing-price-alert.ts.
   */
  redFlags?: RedFlag[];
  /**
   * What the agent was last emailed about, as alertKey(redFlags). Carried
   * forward while the same red flags stand, so they are emailed once; cleared
   * when there are none, so a recurrence is emailed again.
   */
  alertedKey?: string;
};

// The scheduled advertised-price check starts on 1 November 2026, when the new
// NSW legislation commences (RealComply, 8 Oct 2026). Midnight in Sydney,
// which is still daylight saving (+11:00) on that date.
//
// Before then the 7am run only finds listing pages (discovery), so every live
// listing has its page recorded and is checked from the first morning. From
// then, every live listing is checked daily and no price on the ad is a red
// flag. "Check now" on a listing works before the date, but a page with no
// price only becomes a red flag from it.
const PRICE_CHECK_FROM = new Date("2026-11-01T00:00:00+11:00");

/** Identifies a set of red flags: the same price below the same ESP is the same alert. */
function alertKey(flags: RedFlag[]): string {
  return flags.map((f) => `${f.kind}:${f.text}`).sort().join("|");
}

/** What the model read off the page. Everything else is worked out in code. */
type PageRead = {
  priceShown: boolean;
  priceText?: string;
  priceLow?: number;
  priceHigh?: number;
  prohibitedTerms: string[];
  addressConfirmed: boolean;
};

// Every live listing is checked every morning (RealComply, 8 Oct 2026): the
// page is fetched and compared daily, and read by the model whenever its price
// area has changed. This is a floor under that: a full model read at least
// every second day even when nothing changed, because a reused read is a
// comparison, not a reading of the ad, and it catches what the comparison
// cannot see (e.g. the page swapped to another property with an identical
// price block). Just under 48h so a read made at 7:00:30 is not still "fresh"
// by a few seconds at the 7:00 run two days later.
const MAX_REUSE_MS = 47 * 60 * 60 * 1000;

const PRICE_SIGNAL =
  /\$\s?\d|\bprice\b|\bguide\b|\boffers?\b|\bauction\b|contact agent|expressions? of interest|\bEOI\b|\bPOA\b|o\.n\.o|\bsold\b|under (offer|contract)|for sale/gi;

/**
 * The part of the page a price lives in: 150 characters either side of every
 * dollar figure or price word, merged where they overlap.
 *
 * Deliberately generous. Other listings' prices on the same page are swept in
 * too, so a change to a "similar properties" strip costs a model read it did
 * not strictly need. The opposite mistake — a real price change not counted as
 * one — would leave yesterday's verdict standing on today's ad.
 */
function priceArea(text: string): string {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(PRICE_SIGNAL)) {
    const start = Math.max(0, m.index - 150);
    const end = Math.min(text.length, m.index + m[0].length + 150);
    const last = spans[spans.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  return spans.map(([a, b]) => text.slice(a, b)).join(" … ");
}

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
  // A listing page that hangs should fail the check, not the whole daily run.
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
  { forceRead = false }: { forceRead?: boolean } = {},
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
      // Compare with the last read before paying for another one. Reuse only
      // a read of the same URL, made by the model (not an error), within the
      // last two days, with a price area byte-for-byte the same as today's. A page
      // with no price area at all is always read — nothing to compare.
      const area = priceArea(text);
      const priceAreaHash = createHash("sha256").update(area).digest("hex");
      const previous = await previousScan(supabase, property.id);
      const reusable =
        !forceRead &&
        area.length > 0 &&
        previous?.priceAreaHash === priceAreaHash &&
        previous.url === property.listing_url &&
        previous.readAt != null &&
        Date.now() - new Date(previous.readAt).getTime() < MAX_REUSE_MS;

      const { read, readAt, usage } = reusable
        ? {
            read: {
              priceShown: previous.priceShown,
              priceText: previous.priceText,
              priceLow: previous.priceLow,
              priceHigh: previous.priceHigh,
              prohibitedTerms: previous.prohibitedTerms ?? [],
              addressConfirmed: previous.addressConfirmed,
            } satisfies PageRead,
            readAt: previous.readAt!,
            usage: undefined,
          }
        : { ...(await readWithModel(anthropic, property.address, text)), readAt: checkedAt };

      const record = { priceAreaHash, readAt, aiSkipped: reusable, usage };
      finding = await assess(supabase, property.id, base, read, record);
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

/** The last finding on c1, if any. */
async function previousScan(supabase: Db, propertyId: string): Promise<ScanFinding | undefined> {
  const { data } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "c1")
    .maybeSingle();
  return ((data?.data ?? {}) as { websiteScan?: ScanFinding }).websiteScan;
}

/** One model read of the page. Reports what is on it; judges nothing. */
async function readWithModel(
  anthropic: Anthropic,
  address: string,
  text: string,
): Promise<{ read: PageRead; usage: { inputTokens: number; outputTokens: number } }> {
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
        content: `Listing page for ${address}.\n\n${text}`,
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

  return {
    read: {
      priceShown: Boolean(read.priceShown),
      priceText: read.priceText,
      priceLow: read.priceLow,
      priceHigh: read.priceHigh,
      prohibitedTerms: read.prohibitedTerms ?? [],
      addressConfirmed: Boolean(read.addressMatches) && !read.pageLooksWrong,
    },
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}

/**
 * The arithmetic against the ESP on file, from a read of the page — fresh or
 * reused. Redone on every check either way, because the ESP can be revised
 * on a day the page does not change.
 */
async function assess(
  supabase: Db,
  propertyId: string,
  base: { checkedAt: string; url: string },
  read: PageRead,
  record: Pick<ScanFinding, "priceAreaHash" | "readAt" | "aiSkipped" | "usage">,
): Promise<ScanFinding> {
  // The ESP to compare against, read from the file rather than the page,
  // and read as the price CURRENTLY on foot rather than the one recorded
  // at listing set-up. Where a revision notice has been served and read,
  // that is the figure the advertising has to respect — see
  // lib/data/effective-esp.ts.
  const esp = await effectiveEsp(supabase, propertyId);

  const issues: string[] = [];

  const addressConfirmed = read.addressConfirmed;

  // An unconfirmed page produces no verdict at all — neither a clean result
  // nor a breach. Everything below this point assumes we are looking at the
  // right property, and reporting either way on a page we cannot tie to the
  // address is how an automated check quietly misleads someone.
  if (!addressConfirmed) {
    return {
      ...base,
      ...record,
      addressConfirmed: false,
      ok: false,
      priceShown: read.priceShown,
      priceText: read.priceText,
      issues: [],
      summary:
        "Couldn't confirm this page is for this property, so nothing was checked. Open it and, if it's wrong, set the right link in Edit listing details.",
    };
  }

  const redFlags: RedFlag[] = [];

  // Red flags are for a listing still being marketed (On market, Campaign).
  // Once it is Sold the page normally reads "Sold" with no price, and a sale
  // price under the ESP is not underquoting, so neither emails anyone.
  const { data: stageRow } = await supabase.from("properties").select("stage").eq("id", propertyId).maybeSingle();
  const marketing = ((stageRow as { stage?: number } | null)?.stage ?? 0) < 4;

  // No price on the ad is a red flag (RealComply, 8 Oct 2026): every live
  // listing is checked to make sure a price is being advertised. Only on a
  // page confirmed to be this property — see the early return above — and
  // only from PRICE_CHECK_FROM.
  if (!read.priceShown && marketing && new Date(base.checkedAt) >= PRICE_CHECK_FROM) {
    const text =
      `No price is shown on the listing page${read.priceText ? ` (it reads “${read.priceText}”)` : ""}. ` +
      "Add the price guide to the ad.";
    issues.push(text);
    redFlags.push({ kind: "no_price", text });
  }

  // Arithmetic, not judgement.
  if (read.priceLow != null && esp.low != null && read.priceLow < esp.low) {
    const text =
      `Advertised price starts at $${read.priceLow.toLocaleString("en-AU")}, below the ${espLabel(esp)} of $${esp.low.toLocaleString("en-AU")} on this file (s73(1)).` +
        (esp.revised
          ? ` The price was revised${esp.revisedOn ? ` on ${esp.revisedOn}` : ""}, and s73(3) requires the advertising to be amended or retracted as soon as practicable after that.`
          : " If the ESP has been revised, record the notice on the file so this checks against the right figure.");
    issues.push(text);
    if (marketing) redFlags.push({ kind: "below_esp", text });
  }
  if (read.priceLow != null && read.priceHigh != null && read.priceLow > 0) {
    const spread = ((read.priceHigh - read.priceLow) / read.priceLow) * 100;
    if (spread > 10) {
      issues.push(`Advertised range spreads ${spread.toFixed(1)}%, more than the 10% allowed (s72A(2)).`);
    }
  }
  for (const term of read.prohibitedTerms) {
    issues.push(`Advertising uses “${term}”, which s73(2) prohibits.`);
  }
  if (read.priceShown && esp.low == null) {
    issues.push("No ESP recorded on this file to check the advertised price against.");
  }

  return {
    ...base,
    ...record,
    addressConfirmed,
    ok: issues.length === 0,
    priceShown: read.priceShown,
    priceText: read.priceText,
    priceLow: read.priceLow,
    priceHigh: read.priceHigh,
    prohibitedTerms: read.prohibitedTerms,
    issues,
    redFlags,
    summary: issues.length
      ? `${issues.length} thing${issues.length === 1 ? "" : "s"} to look at on the live ad.`
      : read.priceShown
        ? `Advertised at ${read.priceText ?? "the recorded guide"}, consistent with the ESP on file.`
        : "No price shown on the listing page. Nothing to check against the ESP.",
  };
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
 * tomorrow's run while they are looking the other way.
 *
 * Nor re-raised by a check that reused the last read and found exactly the
 * same issues — the agent was already told about that page. Since the run went
 * daily that would otherwise reopen a done item every morning. A fresh read
 * (at least every second day) still re-raises, and so does a reused read
 * whose issues changed, e.g. because the ESP was revised.
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

  const previous = ((row?.data ?? {}) as { websiteScan?: ScanFinding }).websiteScan;
  const alreadyTold =
    finding.aiSkipped === true && JSON.stringify(previous?.issues ?? []) === JSON.stringify(finding.issues);
  const shouldFlag = finding.addressConfirmed && finding.issues.length > 0 && !alreadyTold;

  // Email the agent about a red flag once. Only a confirmed read can clear the
  // record of what was sent: a page that failed to load or could not be tied
  // to the address says nothing about whether the issue is fixed, and
  // clearing on it would re-send the same email on the next good read.
  const flags = finding.redFlags ?? [];
  const key = flags.length > 0 ? alertKey(flags) : undefined;
  const newAlert = finding.addressConfirmed && key !== undefined && key !== previous?.alertedKey;
  finding.alertedKey = finding.addressConfirmed ? key : previous?.alertedKey;

  // The advertised price moved but the file says the ESP was never revised.
  //
  // Adam, 22 Aug 2026, agreeing this should re-ask: a price changing on the
  // website without a revision on file is one of two things, and both need a
  // person. Either a revision happened and the notice was never recorded,
  // which leaves s72A(4) unevidenced, or the advertising moved without one,
  // which is the underquoting case s73 is about.
  //
  // Re-asking rather than flagging c1, because the question belongs on the
  // revision card and the agent needs to be asked again, not told off. The
  // reopen only fires on an answered "no" — see reopenNoRevisionIfPriceMoved.
  const priceMoved =
    finding.addressConfirmed &&
    previous?.priceLow != null &&
    finding.priceLow != null &&
    previous.priceLow !== finding.priceLow;

  if (priceMoved) {
    const { reopenNoRevisionIfPriceMoved } = await import("@/lib/actions/compliance");
    await reopenNoRevisionIfPriceMoved(
      property.id,
      `The advertised price changed from $${previous!.priceLow!.toLocaleString("en-AU")} to $${finding.priceLow!.toLocaleString("en-AU")} on your listing page, but this file records no revision. If the estimated selling price was revised, attach the notice. If it was not, the advertising has moved without one.`,
    );
  }

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

  // Recorded above, sent here: a crash between the two loses one email rather
  // than sending it every morning. Same order as the licence reminders.
  if (newAlert) await alertAgent(supabase, property.id, finding.url, flags);
}

/**
 * Emails the listing's agent (properties.created_by, which follows a listing
 * transfer). If that agent has left the office, the licensee in charge gets it
 * instead, so a red flag on a live ad is never mailed to nobody.
 */
async function alertAgent(supabase: Db, propertyId: string, url: string, flags: RedFlag[]): Promise<void> {
  const { data: prop } = await supabase
    .from("properties")
    .select("agency_id, address, created_by")
    .eq("id", propertyId)
    .maybeSingle();
  const p = prop as { agency_id: string; address: string; created_by: string | null } | null;
  if (!p) return;

  const { data: staff } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_licensee_in_charge, archived_at")
    .eq("agency_id", p.agency_id);
  const people = ((staff ?? []) as Array<{
    id: string;
    email: string | null;
    full_name: string | null;
    is_licensee_in_charge: boolean | null;
    archived_at: string | null;
  }>).filter((s) => !s.archived_at && s.email);

  const agent = people.find((s) => s.id === p.created_by);
  const recipients = agent ? [agent] : people.filter((s) => s.is_licensee_in_charge);

  for (const r of recipients) {
    await sendListingAlert({
      to: r.email!,
      agentName: r.full_name,
      address: p.address,
      url,
      propertyId,
      flags,
    });
  }
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

  // Same path as the daily run: find the page if we do not have one yet.
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

  // Always a fresh read. Someone pressing the button wants the page looked
  // at now, not told it looked the same as this morning.
  await scanOneProperty(supabase, anthropic, { ...p, listing_url: url }, { forceRead: true });

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * The daily sweep, for the cron route, at 7am Sydney time every day (see the
 * route for how that is held across daylight saving).
 *
 * Service-role client: there is no logged-in user on a scheduled run, same
 * reasoning as the weekly digest. Only reaches listings that are on market or
 * later and have a URL, because a listing not yet advertised has no
 * advertisement to check.
 *
 * Most mornings most pages have not changed, and those cost a page fetch and
 * no model call — see priceArea and MAX_REUSE_MS.
 */
export async function runDailyListingScan(): Promise<{
  discovered: number;
  checked: number;
  read: number;
  skipped: number;
  withIssues: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const none = { discovered: 0, checked: 0, read: 0, skipped: 0, withIssues: 0, inputTokens: 0, outputTokens: 0 };
  if (!process.env.ANTHROPIC_API_KEY) return none;

  const supabase = createServiceClient();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Every on-market listing, not only the ones already linked to a page. A
  // listing with no page recorded gets one found for it first, every morning,
  // so a listing that goes live without a link is checked from the first day
  // its page can be found.
  const { data: rows } = await supabase
    .from("properties")
    .select("id, agency_id, address, listing_url, stage")
    .gte("stage", 2)
    .lte("stage", 4);

  // Not for an agency whose subscription has ended. Its records are frozen
  // and AI features are off for it.
  const { data: endedRows } = await supabase.from("agencies").select("id").not("ended_at", "is", null);
  const ended = new Set(((endedRows ?? []) as Array<{ id: string }>).map((a) => a.id));

  const properties = ((rows ?? []) as Array<{
    id: string;
    agency_id: string;
    address: string;
    listing_url: string | null;
  }>).filter((p) => !ended.has(p.agency_id));

  const db = supabase as unknown as Db;
  const checking = new Date() >= PRICE_CHECK_FROM;
  let discovered = 0;
  let checked = 0;
  let read = 0;
  let skipped = 0;
  let withIssues = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const property of properties) {
    // Sequential rather than parallel. Not worth hammering an agency's own
    // website with concurrent requests for one check a day.
    let url = property.listing_url;
    if (!url) {
      url = await discoverListingUrl(db, anthropic, property);
      if (!url) continue; // not published yet, or not findable — try again tomorrow
      discovered += 1;
    }

    // Before 1 November: find pages only. See PRICE_CHECK_FROM.
    if (!checking) continue;

    const finding = await scanOneProperty(db, anthropic, { ...property, listing_url: url });
    if (finding) {
      checked += 1;
      if (finding.aiSkipped) skipped += 1;
      else if (finding.usage) {
        read += 1;
        inputTokens += finding.usage.inputTokens;
        outputTokens += finding.usage.outputTokens;
      }
      if (!finding.ok) withIssues += 1;
    }
  }

  return { discovered, checked, read, skipped, withIssues, inputTokens, outputTokens };
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
 * Runs automatically every morning (see runDailyListingScan) for any on-market
 * listing that has no page recorded yet. There is deliberately no button for this.
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
 * a listing not yet published has no page, and in a day or two it will.
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
    // thing to start doing quietly on a schedule.
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
    // A website that cannot be read is the next run's problem, not an error the
    // agent needs to see — they did not ask for this to run.
    return null;
  }
}
