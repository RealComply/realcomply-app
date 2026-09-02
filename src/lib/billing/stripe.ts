import { createHmac, timingSafeEqual } from "crypto";
import { PLANS, annualPrice, type BillingStatus, type Plan } from "./entitlement";

// Stripe, over plain fetch. No SDK, deliberately.
//
// Three calls are needed — create a checkout session, create a portal
// session, look up a price — plus one signature check. Against that, adding
// the SDK means a package-lock diff of several hundred lines travelling by git
// bundle to a laptop with no Node on it, which is the one machine that cannot
// resolve a lockfile conflict. The repo already hand-rolls HMAC for the
// unsubscribe tokens; this is the same shape of thing.
//
// The one piece with real teeth is verifyStripeSignature below, which is what
// stands between the webhook and anyone who finds the URL. It implements
// Stripe's documented scheme exactly, and its tolerance parameter and clock
// are both injectable precisely so the replay window can be exercised without
// waiting five minutes.

const API = "https://api.stripe.com/v1";

/** Monthly or annual. Half of a lookup key; the plan is the other half. */
export type Interval = "monthly" | "annual";

export function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return key;
}

/** True when we are pointed at a sandbox. Used to label the billing screen. */
export function isTestMode(): boolean {
  return !(process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
}

export async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string | undefined>,
): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) body.append(k, v);
  }

  const response = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "GET" ? undefined : body,
    // Stripe is the source of truth for money and must never be read from a
    // cache, least of all Next's, which caches fetch by default in places.
    cache: "no-store",
  });

  const json = (await response.json()) as T & { error?: { message?: string; type?: string } };

  if (!response.ok) {
    throw new Error(`Stripe ${method} ${path}: ${json?.error?.message ?? response.statusText}`);
  }

  return json;
}

// ─────────────────────────────────────────────────────────────────────────
// Lookup keys
// ─────────────────────────────────────────────────────────────────────────
//
// The app never stores a Stripe price ID. It asks for the price named
// "office_2_monthly", which is a name we chose and which is identical in the
// sandbox and in production. That is what makes going live a re-run of
// scripts/stripe-setup.py rather than sixteen environment variables.

export function lookupKeyFor(plan: Plan, interval: Interval): string {
  return `${plan}_${interval}`;
}

export function planFromLookupKey(key: string): Plan | null {
  const base = key.replace(/_(monthly|annual)$/, "");
  return base in PLANS ? (base as Plan) : null;
}

export function intervalFromLookupKey(key: string): Interval | null {
  if (key.endsWith("_monthly")) return "monthly";
  if (key.endsWith("_annual")) return "annual";
  return null;
}

/** What this plan and interval should cost, in cents. */
export function expectedAmount(plan: Plan, interval: Interval): number {
  const dollars = interval === "annual" ? annualPrice(plan) : PLANS[plan].price;
  return dollars * 100;
}

type StripePrice = {
  id: string;
  unit_amount: number | null;
  currency: string;
  lookup_key: string | null;
  recurring?: { interval?: string } | null;
};

// Cached for the life of the server process. Prices change about never, and a
// lookup on every page render is a round trip to Stripe for a value that
// cannot have moved. A deploy clears it, which is the same moment the ladder
// would have changed in code.
const priceCache = new Map<string, string>();

/**
 * The Stripe price ID for a plan, by name.
 *
 * THE CROSS-CHECK IS THE POINT. The ladder is written in four places — the
 * migration, entitlement.ts, the setup script and the landing page — and the
 * one failure that costs real money is Stripe charging a number the product
 * never advertised. So this refuses to hand back a price whose amount,
 * currency or billing interval disagrees with PLANS.
 *
 * Throwing beats warning here. A mismatch means someone is about to be
 * charged the wrong amount; a checkout that fails loudly is recoverable in
 * minutes, and a subscription created at the wrong price is a refund, an
 * apology and a customer who now reads every invoice.
 */
export async function priceIdFor(plan: Plan, interval: Interval): Promise<string> {
  const lookupKey = lookupKeyFor(plan, interval);
  const cached = priceCache.get(lookupKey);
  if (cached) return cached;

  const query = new URLSearchParams({ limit: "1", active: "true" });
  query.append("lookup_keys[]", lookupKey);

  const found = await stripeRequest<{ data: StripePrice[] }>("GET", `/prices?${query.toString()}`);
  const price = found.data?.[0];

  if (!price) {
    throw new Error(
      `No active Stripe price named "${lookupKey}". Run scripts/stripe-setup.py against this account.`,
    );
  }

  const wantAmount = expectedAmount(plan, interval);
  const wantInterval = interval === "annual" ? "year" : "month";

  if (price.unit_amount !== wantAmount) {
    throw new Error(
      `Stripe price "${lookupKey}" is ${price.unit_amount} cents; the product advertises ${wantAmount}. ` +
        `Refusing to charge a price the product does not show. Re-run scripts/stripe-setup.py.`,
    );
  }
  if (price.currency !== "aud") {
    throw new Error(`Stripe price "${lookupKey}" is in ${price.currency}, not aud.`);
  }
  if (price.recurring?.interval !== wantInterval) {
    throw new Error(
      `Stripe price "${lookupKey}" bills every ${price.recurring?.interval}, expected ${wantInterval}.`,
    );
  }

  priceCache.set(lookupKey, price.id);
  return price.id;
}

// ─────────────────────────────────────────────────────────────────────────
// Webhook signatures
// ─────────────────────────────────────────────────────────────────────────

/**
 * Verifies a Stripe-Signature header against the raw request body.
 *
 * This is the only thing standing between the webhook route and anyone who
 * finds its URL, and that route can change an agency's plan — so it fails
 * closed on anything it does not fully understand.
 *
 * Stripe's scheme: the header is a comma-separated list of key=value pairs
 * carrying a timestamp `t` and one or more `v1` signatures. The signed value
 * is the timestamp, a full stop, and the raw body EXACTLY as sent — re-encoded
 * JSON will not match, which is why the caller reads request.text() and never
 * request.json().
 *
 * More than one v1 can be present while a secret is being rotated, so every
 * one is checked.
 *
 * The timestamp tolerance stops a captured request being replayed later. Five
 * minutes is Stripe's own default.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader || !secret) return false;

  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of signatureHeader.split(",")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }

  if (!timestamp || signatures.length === 0) return false;

  const issued = Number(timestamp);
  if (!Number.isFinite(issued)) return false;
  if (Math.abs(nowSeconds - issued) > toleranceSeconds) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "utf8");
    // Length has to match before timingSafeEqual will look at it, and an
    // unequal length is already a mismatch — no information leaks by saying so.
    if (candidateBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

/**
 * Stripe's subscription statuses, mapped onto ours.
 *
 * Ours are deliberately fewer. The product makes one decision from this — may
 * they create new records — and every shade of "the money is not arriving"
 * gives the same answer.
 *
 * Anything unrecognised maps to past_due rather than active. Stripe adds
 * statuses over time, and an unknown state should read as "look at this",
 * never as "let them carry on". past_due is also recoverable by itself: the
 * next event that says active puts them straight back.
 *
 * Lives here rather than in the webhook route because a Next route file may
 * only export its HTTP handlers, and a mapping nobody can call is a mapping
 * nobody can test.
 */
export function billingStatusFor(stripeStatus: string): BillingStatus {
  switch (stripeStatus) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    // past_due, unpaid, incomplete, paused, and anything Stripe adds later.
    default:
      return "past_due";
  }
}
