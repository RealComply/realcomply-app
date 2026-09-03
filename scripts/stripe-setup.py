#!/usr/bin/env python3
"""Creates (or corrects) RealComply's plans in Stripe. Run it, don't click it.

WHY PYTHON, IN A NODE PROJECT. The person who runs this is Adam, on his Mac,
and his Mac has no Node — it has never needed one, because Vercel does the
building. It does have Python 3, which arrives with Apple's command line tools
alongside git. A setup script that needs a runtime installed before it can run
is a setup script that does not get run. Nothing else here is Python and
nothing else should be.

WHY A SCRIPT AND NOT THE DASHBOARD. Sixteen prices built by hand is sixteen
chances to type 549 as 594, and the Stripe dashboard cannot set a price's
LOOKUP KEY at all — which is the thing that makes the rest of this simple.

A lookup key is a name we choose ("office_2_monthly") that points at a price.
The app asks Stripe for the price named office_2_monthly rather than for
price_1Q7xK2..., so:
  - no price IDs in environment variables (there would be sixteen of them),
  - test mode and live mode use the same names, so nothing has to be
    re-pointed when we go live,
  - raising a price later is one re-run of this script: it creates the new
    price, moves the name onto it, and archives the old one. Existing
    subscribers keep the price they signed up on, which is what we want.

SAFE TO RE-RUN. It checks before it writes and skips anything already right.

HOW TO RUN IT (from the repo folder):
  STRIPE_SECRET_KEY=sk_test_... python3 scripts/stripe-setup.py

The key is read from the environment and is never written anywhere.

No third-party packages, deliberately — urllib is in the standard library, so
there is nothing to pip install first.
"""

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# The ladder. KEEP IN SYNC with PLANS in src/lib/billing/entitlement.ts.
#
# Prices are GST INCLUSIVE, per RealComply-pricing-and-billing-model.md —
# quoting anything else to an Australian small business is the wrong number,
# so tax_behavior below is "inclusive" and not Stripe's default.
#
# Annual is ten months for twelve, matching annualPrice() in entitlement.ts.
PLANS = [
    {"plan": "agent_1",  "name": "Agent 1",  "monthly": 99,   "blurb": "One agent, up to 25 listings per year."},
    {"plan": "agent_2",  "name": "Agent 2",  "monthly": 169,  "blurb": "One agent, 26 to 60 listings per year."},
    {"plan": "agent_3",  "name": "Agent 3",  "monthly": 249,  "blurb": "One agent, more than 60 listings per year."},
    {"plan": "office_1", "name": "Office 1", "monthly": 249,  "blurb": "Office compliance, up to 50 listings per year."},
    {"plan": "office_2", "name": "Office 2", "monthly": 349,  "blurb": "Office compliance, 51 to 150 listings per year."},
    {"plan": "office_3", "name": "Office 3", "monthly": 549,  "blurb": "Office compliance, 151 to 250 listings per year."},
    {"plan": "office_4", "name": "Office 4", "monthly": 749,  "blurb": "Office compliance, 251 to 400 listings per year."},
    {"plan": "office_5", "name": "Office 5", "monthly": 1049, "blurb": "Office compliance, more than 400 listings per year."},
]

ANNUAL_MONTHS = 10  # two months free

# What appears on the agent's bank or card statement. Left unset, a direct
# debit shows as whatever Stripe decides, and an unrecognised line on a
# business account gets disputed rather than queried. Max 22 characters.
STATEMENT_DESCRIPTOR = "REALCOMPLY"
PRODUCT_URL = "https://www.realcomply.com.au"

def looks_like_a_key(value):
    return value.startswith("sk_test_") or value.startswith("sk_live_")


def get_key():
    """The key, from the environment or by asking.

    ASKING IS THE PRIMARY PATH, not a fallback, and it exists because the
    alternatives both went wrong in practice on 2 Sep 2026. Putting the key in
    the command means editing the middle of a line someone has just pasted;
    setting it up first with `read` means two commands, and two commands pasted
    together means the first one swallows the second as its input and the real
    key ends up typed at the shell prompt, in the history, where it has to be
    rolled.

    So: one command, and the script asks. An environment variable still wins
    when it is set, for anywhere this runs unattended.

    A value that is present but malformed falls through to the prompt rather
    than stopping. That is the exact shape of the failure above — the variable
    held a stray command, not a key — and the useful response is to ask again,
    not to exit and make someone work out what is in a variable they cannot
    see.
    """
    from_env = os.environ.get("STRIPE_SECRET_KEY", "").strip()
    if looks_like_a_key(from_env):
        return from_env

    if from_env:
        print("\nSTRIPE_SECRET_KEY is set, but it isn't a Stripe key. Ignoring it.")

    print("\nPaste your Stripe SECRET key and press Enter.")
    print("It is the one that starts sk_test_ (or sk_live_), not pk_.")
    print("Nothing is shown back and nothing is saved.\n")

    try:
        typed = input("Key: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nStopped, nothing changed.\n")
        sys.exit(1)

    if not looks_like_a_key(typed):
        if typed.startswith("pk_"):
            print("\nThat's the publishable key. The secret one is the row below it,")
            print("behind the Reveal button.\n")
        else:
            print("\nThat doesn't look like a Stripe secret key — it should start sk_test_ or sk_live_.\n")
        sys.exit(1)

    return typed


KEY = get_key()
MODE = "LIVE" if KEY.startswith("sk_live_") else "TEST"

# Going live should be a decision, not a paste. Everything this script writes
# in live mode is a real price tag that a real customer can be charged against,
# and the difference between the two keys is four characters in the middle of a
# long string nobody reads.
if MODE == "LIVE":
    print("\nThat is a LIVE key. This will create real, chargeable prices.")
    try:
        if input("Type LIVE to continue: ").strip() != "LIVE":
            print("\nStopped, nothing changed.\n")
            sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print("\nStopped, nothing changed.\n")
        sys.exit(1)


def stripe(method, path, params=None):
    """One request. Returns the parsed body, or None when Stripe says 404.

    A 404 on a retrieve is an answer ("not there yet"), not a failure, so it
    comes back as None and the caller decides what it means.
    """
    url = "https://api.stripe.com/v1" + path
    data = None
    if method != "GET":
        clean = {k: str(v) for k, v in (params or {}).items() if v is not None}
        data = urlencode(clean).encode("utf-8")

    request = Request(url, data=data, method=method)
    request.add_header("Authorization", "Bearer " + KEY)
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    # Tells Stripe's logs this was us, which makes the dashboard's event list
    # readable when something has to be traced back.
    request.add_header("User-Agent", "realcomply-setup")

    try:
        with urlopen(request) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 404:
            return None
        body = {}
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            pass
        err = body.get("error", {})
        raise SystemExit(
            "\nStopped: " + err.get("message", "HTTP %s from Stripe" % e.code) + "\n"
        )
    except URLError as e:
        # No network, DNS down, Stripe unreachable. Left uncaught this prints
        # forty lines of Python traceback, which reads as "the script is
        # broken" to anyone who is not a programmer. It isn't; nothing was
        # written, and trying again later is the whole fix.
        raise SystemExit(
            "\nCouldn't reach Stripe (%s).\n"
            "Nothing was created. Check the internet connection and run it again.\n"
            % (e.reason,)
        )


def product_id(plan):
    """Product IDs are ours, chosen and stable, so this can find its own work again."""
    return "realcomply_" + plan


def ensure_product(spec):
    pid = product_id(spec["plan"])
    display_name = "RealComply " + spec["name"]
    existing = stripe("GET", "/products/" + pid)

    if existing is None:
        stripe("POST", "/products", {
            "id": pid,
            "name": display_name,
            "description": spec["blurb"],
            "statement_descriptor": STATEMENT_DESCRIPTOR,
            "url": PRODUCT_URL,
            "metadata[plan]": spec["plan"],
        })
        return pid

    # Bring an existing one back into line — including un-archiving it, since a
    # product archived by hand in the dashboard would otherwise stay invisible
    # at checkout while this script cheerfully reported everything present.
    drifted = (
        existing.get("active") is not True
        or existing.get("name") != display_name
        or existing.get("description") != spec["blurb"]
        or existing.get("statement_descriptor") != STATEMENT_DESCRIPTOR
        or (existing.get("metadata") or {}).get("plan") != spec["plan"]
    )
    if drifted:
        stripe("POST", "/products/" + pid, {
            "active": "true",
            "name": display_name,
            "description": spec["blurb"],
            "statement_descriptor": STATEMENT_DESCRIPTOR,
            "url": PRODUCT_URL,
            "metadata[plan]": spec["plan"],
        })

    return pid


def find_by_lookup_key(lookup_key):
    query = urlencode({"limit": "1", "active": "true", "lookup_keys[]": lookup_key})
    listing = stripe("GET", "/prices?" + query)
    items = (listing or {}).get("data") or []
    return items[0] if items else None


def ensure_price(plan, product_stripe_id, interval, dollars, lookup_key):
    cents = dollars * 100
    existing = find_by_lookup_key(lookup_key)

    if (
        existing
        and existing.get("unit_amount") == cents
        and existing.get("currency") == "aud"
        and (existing.get("recurring") or {}).get("interval") == interval
        and existing.get("product") == product_stripe_id
    ):
        return "already correct"

    # transfer_lookup_key moves the name off the old price onto the new one in
    # the same call, so there is never a moment where the app looks up the name
    # and finds nothing.
    stripe("POST", "/prices", {
        "product": product_stripe_id,
        "currency": "aud",
        "unit_amount": str(cents),
        "recurring[interval]": interval,
        # GST is inside the advertised number.
        "tax_behavior": "inclusive",
        "lookup_key": lookup_key,
        "transfer_lookup_key": "true" if existing else None,
        "nickname": "%s %sly" % (plan, interval),
        "metadata[plan]": plan,
        "metadata[interval]": interval,
    })

    if existing:
        # Archived, never removed. Anyone already subscribed on the old price
        # keeps paying it — Stripe honours the price a subscription was created
        # on — and archiving only stops it being offered to anyone new.
        stripe("POST", "/prices/" + existing["id"], {"active": "false"})
        return "replaced (old one archived)"

    return "created"


def main():
    print("\nRealComply plans — Stripe %s mode\n" % MODE)

    rows = []
    for spec in PLANS:
        pid = ensure_product(spec)

        monthly = ensure_price(
            spec["plan"], pid, "month", spec["monthly"], spec["plan"] + "_monthly"
        )
        annual = ensure_price(
            spec["plan"], pid, "year", spec["monthly"] * ANNUAL_MONTHS, spec["plan"] + "_annual"
        )

        rows.append(("RealComply " + spec["name"], "Monthly",
                     "$%s" % spec["monthly"], spec["plan"] + "_monthly", monthly))
        rows.append(("", "Annual",
                     "$%s" % (spec["monthly"] * ANNUAL_MONTHS), spec["plan"] + "_annual", annual))

    headers = ("Plan", "Term", "Price", "Name in Stripe", "Result")
    widths = [max(len(str(r[i])) for r in rows + [headers]) for i in range(5)]
    line = "  ".join("-" * w for w in widths)

    print("  ".join(h.ljust(widths[i]) for i, h in enumerate(headers)))
    print(line)
    for r in rows:
        print("  ".join(str(c).ljust(widths[i]) for i, c in enumerate(r)))
    print(line)

    print("\nDone. %d plans, %d prices, all in %s mode." % (len(PLANS), len(PLANS) * 2, MODE))
    print("Nothing here charges anybody — these are just the price tags.\n")


if __name__ == "__main__":
    main()
