// Creates (or corrects) RealComply's plans in Stripe. Run it, don't click it.
//
// WHY A SCRIPT AND NOT THE DASHBOARD. Twelve prices built by hand is twelve
// chances to type 549 as 594, and the Stripe dashboard cannot set a price's
// LOOKUP KEY at all — which is the thing that makes the rest of this simple.
//
// A lookup key is a name we choose ("office_2_monthly") that points at a price.
// The app asks Stripe for the price named office_2_monthly rather than for
// price_1Q7xK2..., so:
//   - no price IDs in environment variables (there would be twelve of them),
//   - test mode and live mode use the same names, so nothing has to be
//     re-pointed when we go live,
//   - raising a price later is one re-run of this script: it creates the new
//     price, moves the name onto it, and archives the old one. Existing
//     subscribers keep the price they signed up on, which is what we want.
//
// SAFE TO RE-RUN. It checks before it writes and skips anything already right.
//
// HOW TO RUN IT (from the repo folder):
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs
//
// The key is read from the environment and is never written anywhere.

// The ladder. KEEP IN SYNC with PLANS in src/lib/billing/entitlement.ts.
//
// Prices are GST INCLUSIVE, per RealComply-pricing-and-billing-model.md —
// quoting anything else to an Australian small business is the wrong number,
// so tax_behavior below is "inclusive" and not Stripe's default.
//
// Annual is ten months for twelve, matching annualPrice() in entitlement.ts.
const PLANS = [
  { plan: "agent_1",  name: "Agent 1",  monthly: 99,   blurb: "One agent, up to 25 listings a year." },
  { plan: "agent_2",  name: "Agent 2",  monthly: 169,  blurb: "One agent, 26 to 60 listings a year." },
  { plan: "agent_3",  name: "Agent 3",  monthly: 249,  blurb: "One agent, more than 60 listings a year." },
  { plan: "office_1", name: "Office 1", monthly: 249,  blurb: "Office compliance, up to 50 listings a year." },
  { plan: "office_2", name: "Office 2", monthly: 349,  blurb: "Office compliance, 51 to 150 listings a year." },
  { plan: "office_3", name: "Office 3", monthly: 549,  blurb: "Office compliance, 151 to 250 listings a year." },
  { plan: "office_4", name: "Office 4", monthly: 749,  blurb: "Office compliance, 251 to 400 listings a year." },
  { plan: "office_5", name: "Office 5", monthly: 1049, blurb: "Office compliance, more than 400 listings a year." },
];

const ANNUAL_MONTHS = 10; // two months free

const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error("\nSTRIPE_SECRET_KEY is not set.\n");
  console.error("Run it like this, with your own key in place of sk_test_...:\n");
  console.error("  STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs\n");
  process.exit(1);
}

const MODE = KEY.startsWith("sk_live_") ? "LIVE" : KEY.startsWith("sk_test_") ? "TEST" : "UNKNOWN";
if (MODE === "UNKNOWN") {
  console.error("\nThat does not look like a Stripe secret key. It should begin sk_test_ or sk_live_.\n");
  process.exit(1);
}

// Form-encoding by hand, because this script deliberately has no dependencies:
// it has to be runnable before anything is installed, and on a laptop that has
// never built this project.
function form(params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.append(k, String(v));
  }
  return body;
}

async function stripe(method, path, params) {
  const url = `https://api.stripe.com/v1${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      // Tells Stripe's logs this was us, which makes the dashboard's event
      // list readable when something has to be traced back.
      "User-Agent": "realcomply-setup",
    },
    body: method === "GET" ? undefined : form(params ?? {}),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = json?.error ?? {};
    // 404 on a retrieve is an answer, not a failure — the caller handles it.
    if (res.status === 404) return null;
    throw new Error(`${err.type ?? "error"}: ${err.message ?? res.statusText}`);
  }
  return json;
}

/** Product IDs are ours, chosen and stable, so this can find its own work again. */
function productId(plan) {
  return `realcomply_${plan}`;
}

// What appears on the agent's bank or card statement. Left unset, a direct
// debit shows as whatever Stripe decides, and an unrecognised line on a
// business account gets disputed rather than queried. Max 22 characters.
const STATEMENT_DESCRIPTOR = "REALCOMPLY";
const PRODUCT_URL = "https://www.realcomply.com.au";

async function ensureProduct(spec) {
  const id = productId(spec.plan);
  const existing = await stripe("GET", `/products/${id}`);

  if (!existing) {
    await stripe("POST", "/products", {
      id,
      name: `RealComply ${spec.name}`,
      description: spec.blurb,
      statement_descriptor: STATEMENT_DESCRIPTOR,
      url: PRODUCT_URL,
      "metadata[plan]": spec.plan,
    });
    return { id, created: true };
  }

  // Bring an existing one back into line — including un-archiving it, since a
  // product archived by hand in the dashboard would otherwise stay invisible
  // at checkout while this script cheerfully reported everything present.
  const drifted =
    existing.active !== true ||
    existing.name !== `RealComply ${spec.name}` ||
    existing.description !== spec.blurb ||
    existing.statement_descriptor !== STATEMENT_DESCRIPTOR ||
    existing.metadata?.plan !== spec.plan;

  if (drifted) {
    await stripe("POST", `/products/${id}`, {
      active: "true",
      name: `RealComply ${spec.name}`,
      description: spec.blurb,
      statement_descriptor: STATEMENT_DESCRIPTOR,
      url: PRODUCT_URL,
      "metadata[plan]": spec.plan,
    });
  }

  return { id, created: false, updated: drifted };
}

async function findByLookupKey(lookupKey) {
  const q = new URLSearchParams({ limit: "1", active: "true" });
  q.append("lookup_keys[]", lookupKey);
  const list = await stripe("GET", `/prices?${q.toString()}`);
  return list?.data?.[0] ?? null;
}

async function ensurePrice({ plan, productStripeId, interval, dollars, lookupKey }) {
  const cents = dollars * 100;
  const existing = await findByLookupKey(lookupKey);

  if (
    existing &&
    existing.unit_amount === cents &&
    existing.currency === "aud" &&
    existing.recurring?.interval === interval &&
    existing.product === productStripeId
  ) {
    return { id: existing.id, state: "already correct" };
  }

  // transfer_lookup_key moves the name off the old price onto the new one in
  // the same call, so there is never a moment where the app looks up the name
  // and finds nothing.
  const created = await stripe("POST", "/prices", {
    product: productStripeId,
    currency: "aud",
    unit_amount: String(cents),
    "recurring[interval]": interval,
    // GST is inside the advertised number.
    tax_behavior: "inclusive",
    lookup_key: lookupKey,
    transfer_lookup_key: existing ? "true" : undefined,
    nickname: `${plan} ${interval}ly`,
    "metadata[plan]": plan,
    "metadata[interval]": interval,
  });

  if (existing) {
    // Archived, never deleted. Anyone already subscribed on the old price keeps
    // paying it — Stripe honours the price a subscription was created on — and
    // archiving only stops it being offered to anyone new.
    await stripe("POST", `/prices/${existing.id}`, { active: "false" });
    return { id: created.id, state: `replaced (old ${existing.id} archived)` };
  }

  return { id: created.id, state: "created" };
}

async function main() {
  console.log(`\nRealComply plans — Stripe ${MODE} mode\n`);

  const rows = [];

  for (const spec of PLANS) {
    const product = await ensureProduct(spec);

    const monthly = await ensurePrice({
      plan: spec.plan,
      productStripeId: product.id,
      interval: "month",
      dollars: spec.monthly,
      lookupKey: `${spec.plan}_monthly`,
    });

    const annual = await ensurePrice({
      plan: spec.plan,
      productStripeId: product.id,
      interval: "year",
      dollars: spec.monthly * ANNUAL_MONTHS,
      lookupKey: `${spec.plan}_annual`,
    });

    rows.push(
      { name: `RealComply ${spec.name}`, term: "Monthly", price: `$${spec.monthly}`, key: `${spec.plan}_monthly`, result: monthly.state },
      { name: "", term: "Annual", price: `$${spec.monthly * ANNUAL_MONTHS}`, key: `${spec.plan}_annual`, result: annual.state },
    );
  }

  console.table(rows);
  console.log(`Done. ${PLANS.length} plans, ${PLANS.length * 2} prices, all in ${MODE} mode.`);
  console.log("Nothing here charges anybody — these are just the price tags.\n");
}

main().catch((e) => {
  console.error(`\nStopped: ${e.message}\n`);
  process.exit(1);
});
