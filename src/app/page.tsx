import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { EarlyAccessForm } from "@/components/EarlyAccessForm";
import { MetaPixel } from "@/components/MetaPixel";
import { PublicAnalytics } from "@/components/PublicAnalytics";
import { BeforeAfter } from "@/components/landing/BeforeAfter";
import { ProductScreen } from "@/components/landing/ProductScreen";
import { TimeBack } from "@/components/landing/TimeBack";

// The public landing page, restored 13 Aug 2026 as the destination for Meta
// ads. It had been deleted on 12 Aug in favour of a bare redirect to /login,
// on the reasoning that there was no audience to pitch and no reason to show
// the product to a competitor before there was a client base.
//
// HOW MUCH THIS SAYS — REWRITTEN 17 Aug 2026, and the earlier decision
// deliberately reversed.
//
// From 13 Aug this page described outcomes only, with no mechanics, to avoid
// handing a competitor a blueprint. Two things changed. The competitor turned
// out to be a landing page run by a sole trader, and Adam wants subscribers
// now: "I'm kind of over the competitive thing. We're not gonna be able to do
// that by hiding what the unique and best features of the site are."
//
// The replacement rule, in his words: "people know the result, not the how it
// works." So the page now names what the AI does FOR the reader and still says
// nothing about how any of it is done. No screens, no worked example, no
// thresholds, no triggers, no description of what is read or matched.
//
// REVERSED AGAIN, 22 Oct 2026 (Adam). The page now shows an example product
// screen and a worked underquoting flag (src/components/landing). Speed to
// market against a competitor outweighs hiding the how. The sub-headline was
// also changed the same day and no longer says what the product is; see
// DESCRIPTION below.
//
// The other fault it fixes is comprehension. Adam, 17 Aug 2026: "because I
// know what RealComply is, it all makes sense to me, but some of the way these
// things are worded might seem foreign to someone else." The page never once
// said what the product IS — a stranger could not tell software from a
// consultancy. The hero sub-headline now answers that in one sentence, and it
// is the single most important line on the page.
//
// VOICE: relaxed, with contractions (Adam, 17 Aug 2026: "keep this style the
// same throughout"). The footer disclaimer is the deliberate exception — it is
// liability framing and a formal register is doing work there.
//
// House style otherwise unchanged: plain English, UK spelling, no em-dashes
// inside sentences, and never a promise of compliance.
//
// PROMISES WITH AN EXPIRY. Two things on this page are claims about a product
// state that must stay true. "No set-up fee. No lock-in contracts." comes off
// BEFORE pricing gains either. And the Monday-morning digest line comes off if
// the SES production-access request fails and outbound email stays blocked.
// Both are removed before someone signs up on the strength of them, not after.
// The set-up-fee line now appears in THREE places (hero, pricing, final) —
// update all three together, same rule as the sub-headline below.
//
// PRICING — added 22 Aug 2026, Adam's call: "I think we should have the
// starting prices on the landing page." Starting prices only (Agent $99/mo,
// Office from $249/mo), not the full office tier ladder — see
// RealComply-pricing-and-billing-model.md. Keep these two figures in sync
// with that doc if pricing changes.
//
// The sub-headline is duplicated in three places: here, the openGraph block
// below, and the site-wide fallback in layout.tsx. Change all three together
// or the ad, the search result and the page start disagreeing.

// REVERSAL, 22 Oct 2026 (Adam). The sub-headline no longer says what the
// product is. It now leads with momentum, for speed to market against a
// competitor: "we need to show that we're the bigger, better dog." Adam's
// call, made knowing the 17 Aug reason for the old line (see the hero below).
// The old line, kept for reinstatement: "RealComply is software for NSW real
// estate agencies. It runs the compliance file for every listing you sell,
// from the agency agreement through to settlement, and builds the record as
// you go."
const DESCRIPTION = "Join agencies around NSW in making compliance simple and stress-free.";

export const metadata: Metadata = {
  title: "RealComply — Stay on top of compliance, without a full-time hire",
  description: DESCRIPTION,
  openGraph: {
    title: "RealComply — Stay on top of compliance, without a full-time hire",
    description: DESCRIPTION,
    url: "https://www.realcomply.com.au",
    siteName: "RealComply",
    locale: "en_AU",
    type: "website",
  },
};

// The How it works steps and the four AI feature cards were removed on
// 22 Oct 2026, replaced by the three infographics in src/components/landing
// (Adam, signed off in the Landing page updates thread).

// Split by who is reading (Adam, 17 Aug 2026). A principal can read their own
// column and stop. Each column is also a sequence rather than three unrelated
// points: the licensee's runs oversight, then approval, then evidence; the
// agent's runs start of the job, middle, then the weekly loop.
const FOR_LICENSEE = [
  {
    title: "You can see the whole office.",
    body: "Every listing, every agent, what's done and what's outstanding, without having to chase anyone.",
  },
  {
    title: "Sign-offs come to you.",
    body: "The things that need your name reach you when they're ready, instead of sitting on someone's desk.",
  },
  {
    title: "The evidence is in order.",
    body: "If a file is ever questioned, what you did and when is already recorded.",
  },
];

const FOR_AGENTS = [
  {
    title: "Nothing to chase.",
    body: "Each listing shows what's outstanding, in the order it's needed.",
  },
  {
    title: "Less retyping.",
    body: "What's already in your agreement doesn't get asked for twice.",
  },
  {
    title: "Every Monday morning.",
    body: "A short list of what's outstanding on each listing lands in your inbox, so you know what needs to be actioned.",
  },
];

function Tick() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#0ca678"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0"
      aria-hidden="true"
    >
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

// PageProps<"/"> is the type Next generates for this route, matching how the
// root layout already types itself with LayoutProps<"/">. searchParams there
// is a Record of string | string[] | undefined, so ?src=a&src=b arrives as an
// array — take the first and ignore the rest rather than letting an array
// reach the database column.
export default async function RootPage({ searchParams }: PageProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  // ?src= on the ad's link lands in the row, so the list can be read back as
  // "which ad produced this" without relying on Meta's own attribution.
  const rawSrc = (await searchParams).src;
  const src = Array.isArray(rawSrc) ? rawSrc[0] : rawSrc;

  return (
    // flex-1 rather than min-h-full. This page is always far taller than the
    // viewport, so a percentage min-height could only ever be a no-op or a
    // source of trouble — and percentage heights resolved against a flex
    // parent whose own height is auto are exactly the kind of thing that
    // behaves differently on mobile Safari. flex-1 gives the same
    // fill-the-column behaviour without the percentage.
    <main className="flex-1 bg-white text-rc-ink">
      <header>
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/" aria-label="RealComply home">
            <Logo size={19} />
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-rc-muted hover:text-rc-ink" data-cta="nav-login">
              Log in
            </Link>
            {/* Added 23 Oct 2026 (trial brief): jumps to the form in the hero.
                Not a sign-up page; there is still no self-serve sign-up. */}
            <a
              href="#early-access"
              className="rounded-full bg-rc-ink px-4 py-2 text-sm font-bold text-white transition hover:bg-rc-green-deep"
              data-cta="nav-trial"
            >
              Start free trial
            </a>
          </div>
        </div>
      </header>

      {/* HERO — what it is, then the single ask, above the fold on a phone.
          Most Meta traffic is mobile, so nothing else competes up here. */}
      {/* SIDE BY SIDE from 23 Oct 2026 (Adam: "i like the side by side intro
          on the left and free trial form on the right", from the free trial
          mockup). On a phone it stacks: intro first, then the form, so the ask
          is still near the top. Wording unchanged from PR #72. The risk
          reversal line joins the ticks on the left, as in the mockup. */}
      <section className="relative isolate overflow-hidden" data-section="hero">
        <div className="rc-mesh-bg" />
        <div className="mx-auto grid max-w-6xl items-center gap-3 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0 text-center lg:text-left">
            {/* Trial badge (trial brief, 23 Oct 2026; wording corrected by Adam
                the same day). Prices include GST, like every price on the site. */}
            <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-rc-green-soft px-4 py-2 text-sm font-bold text-rc-green-deep">
              <span className="h-2 w-2 shrink-0 rounded-full bg-rc-green-deep" aria-hidden="true" />
              14 days free. Agents from $99, offices from $249 a month.
            </p>
            <h1 className="text-4xl font-extrabold leading-[1.06] tracking-tight text-rc-ink sm:text-5xl">
              Stay on top of compliance. <span className="text-rc-green-deep">Without a full-time hire.</span>
            </h1>
            {/* The most important sentence on the page. It replaced "AI
                compliance support for NSW agencies", which never said what the
                product is — a first-time reader could not tell software from a
                consultancy from an outsourced compliance officer, and every line
                after it assumed they had already answered that.

                The AI is deliberately NOT in this sentence any more. It is a
                feature, not the category, and leading with it made the product
                harder to place. It gets a band of its own further down. */}
            <p className="mx-auto mt-4 max-w-lg text-lg text-rc-muted lg:mx-0 lg:text-xl">
              {DESCRIPTION} Upload your first agency agreement and watch RealComply read and file it.
            </p>

            {/* RISK REVERSAL. Adam, 15 Aug 2026: "I really want the person who
                lands on the landing page to feel like there is absolutely no
                risk and nothing to lose." Now a tick beside the other two,
                still in view next to the form. "The licensee stays in charge"
                became "You always have the final say" on 17 Aug 2026. */}
            <ul className="mx-auto mt-7 grid max-w-md gap-2.5 text-left text-base font-semibold text-rc-ink lg:mx-0">
              {["Grounded in NSW legislation", "You always have the final say", "No set-up fee. No lock-in contracts."].map(
                (t) => (
                  <li key={t} className="flex items-center gap-2.5">
                    <Tick />
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>

          {/* The form keeps its own top margin and centring on a phone; beside
              the intro it sits flush in its column. */}
          <div className="min-w-0 lg:[&>div>*]:mt-0">
            {/* Anchored so the closed-signup page can send someone straight to
                the form rather than to the top of the page (24 Aug 2026). */}
            <div id="early-access" className="scroll-mt-24">
              <EarlyAccessForm source={src} />
            </div>
          </div>
        </div>
      </section>

      {/* MISSION — the long version, directly under the hero. The middle
          sentence is the one meant to make a principal recognise themselves. */}
      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="mission">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Why we built it</h2>
          <p className="mt-4 text-lg leading-relaxed text-rc-muted">
            Small agencies carry the same obligations as the big ones, without the back office to carry them. The
            licensee is personally on the hook for every file in the office, and for most, the current system is a
            spreadsheet, a folder, and a good memory.
          </p>
          <p className="mt-4 text-lg font-semibold leading-relaxed text-rc-ink">
            RealComply exists to close that gap. Getting compliance right shouldn&rsquo;t depend on how many people you
            employ.
          </p>
        </div>
      </section>

      {/* INFOGRAPHICS, 22 Oct 2026. Three animated bands replace "How it
          works" and "The part that does the work for you" (Adam: "these new
          parts can replace" both). Each plays when it scrolls into view, and
          hovering or tapping a part replays it. New data-section names, so
          Plausible counts these separately from the old bands. */}
      <section className="border-t border-rc-border py-16 sm:py-20" data-section="before-after">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <BeforeAfter />
        </div>
      </section>

      <section
        className="border-t border-rc-border py-16 sm:py-20"
        style={{ background: "linear-gradient(180deg,#f7fdfa 0%,#ffffff 100%)" }}
        data-section="product-screen"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {/* The "You stay the decision-maker throughout..." line that sat here
              was removed 22 Oct 2026 at Adam's request. The licensee sign-off
              line under the screen and the footer disclaimer still carry it. */}
          <ProductScreen />
        </div>
      </section>

      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="time-back">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <TimeBack />
        </div>
      </section>

      {/* WHAT CHANGES DAY TO DAY. data-section kept as "outcomes" on purpose —
          renaming it would break continuity with the Plausible history from
          the previous version of this band. */}
      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="outcomes">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            {/* Was "Compliance on track. Your time back to do what you do best."
                Shortened 22 Oct 2026 (Adam): the infographics already say time. */}
            Compliance on track.
          </h2>
          <div className="mt-9 grid gap-8 md:grid-cols-2 md:gap-12">
            {[
              { heading: "For the licensee", items: FOR_LICENSEE },
              { heading: "For your agents", items: FOR_AGENTS },
            ].map((col) => (
              <div key={col.heading}>
                <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.09em] text-rc-green-deep">
                  {col.heading}
                </p>
                <ul>
                  {col.items.map((item, i) => (
                    <li
                      key={item.title}
                      className={`flex gap-3 py-3 ${i === 0 ? "pt-0" : "border-t border-rc-border"}`}
                    >
                      <Tick />
                      <span>
                        <span className="block text-[15px] font-bold tracking-tight">{item.title}</span>
                        <span className="mt-0.5 block text-sm leading-relaxed text-rc-muted">{item.body}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY NOW. Rebuilt 17 Aug 2026 — it led on AML/CTF, and Adam pulled
          that: "we're getting caught up on it. For us it is simply a tick box.
          AML is handled by third parties, there's plenty of them, we're not
          playing in that space." The real argument is that the job keeps
          getting heavier and the penalties keep getting bigger.

          EVERY FIGURE HERE IS CHECKABLE and dated. Penalties rose 29 June
          2026; the rest is the reform package expected late 2026. Sources in
          RealComply-NSW-underquoting-reforms-late-2026.md. If commencement
          moves, this band moves with it. */}
      <section className="border-t border-rc-border py-16 sm:py-20" data-section="why">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">The job keeps getting bigger</h2>
          <p className="mt-4 text-lg leading-relaxed text-rc-muted">
            In June, maximum penalties for serious offences rose to{" "}
            <strong className="font-bold text-rc-ink">$110,000 for a company and $55,000 for an individual</strong>, and
            Fair Trading gained new powers to suspend a licence or order an agent back into training.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-rc-muted">
            More lands before the end of the year. A price on every residential advertisement. A statement of
            information that goes to buyers. A record of how you arrived at your estimate. And an underquoting penalty
            set at{" "}
            <strong className="font-bold text-rc-ink">
              $110,000 or three times your commission on the property, whichever is greater
            </strong>
            .
          </p>
          <p className="mt-4 text-lg font-semibold leading-relaxed text-rc-ink">
            More work, more responsibility, and bigger numbers when it goes wrong. A spreadsheet and a good memory
            don&rsquo;t scale with that.
          </p>
        </div>
      </section>

      {/* PRICING — starting prices only, not the full office tier ladder
          (that stays behind login, not on a page a competitor can
          screenshot). Sits right before the final ask, so the price is
          answered before someone is asked for their email. */}
      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="pricing">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Straightforward pricing</h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-relaxed text-rc-muted">
            One plan for a single agent, one for the whole office.
          </p>
          <div className="mt-9 grid gap-5 sm:grid-cols-2">
            <div className="rounded-card border border-rc-border bg-white p-7 text-left shadow-card">
              <p className="text-xs font-extrabold uppercase tracking-[0.09em] text-rc-green-deep">Agent</p>
              <p className="mt-3 text-4xl font-extrabold tracking-tight text-rc-ink">
                From $99<span className="text-lg font-semibold text-rc-muted">/month</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-rc-muted">One agent, your own listings.*</p>
            </div>
            <div className="rounded-card border border-rc-border bg-white p-7 text-left shadow-card">
              <p className="text-xs font-extrabold uppercase tracking-[0.09em] text-rc-green-deep">Office</p>
              <p className="mt-3 text-4xl font-extrabold tracking-tight text-rc-ink">
                From $249<span className="text-lg font-semibold text-rc-muted">/month</span>
              </p>
              <p className="mt-2 text-sm leading-relaxed text-rc-muted">The whole office, every listing.*</p>
            </div>
          </div>
          <p className="mt-6 text-sm font-semibold text-rc-muted">
            No set-up fee. No lock-in contracts. GST inclusive.
          </p>
          {/* Legal caveat, Adam 22 Aug 2026: $249 is the entry tier (up to 50
              listings a year), not a flat office-wide price — a 300-listing
              office pays more. Coverage is unbounded, the headline price
              isn't, and this is the line that keeps "every listing" honest.
              Keep the $249 / 50 figures in sync with
              RealComply-pricing-and-billing-model.md if the tiers change.

              The agent half gained the same caveat on 2 Sep 2026, when the
              flat $99 agent plan became three bands. Both cards already said
              "From", but "from" without a number is the kind of vague that
              reads as a surprise later — and a busy agent finding out at the
              boundary that their price moves is exactly the conversation
              worth avoiding. Say the band on the page. */}
          <p className="mt-2 text-xs text-rc-faint">
            * $99 covers a single agent with up to 25 listings per year, and $249 covers offices with up to 50.
            Busier agents and larger offices scale up from there.
          </p>
        </div>
      </section>

      {/* FINAL — the short mission, then the same ask. Adam kept both mission
          statements: the long one under the hero, this one as the last thing
          read before the email box. */}
      <section
        className="relative isolate overflow-hidden bg-rc-ink-bg py-20 text-center text-white"
        data-section="final"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="mx-auto mb-6 max-w-lg text-[17px] font-bold leading-snug tracking-tight text-white">
            Compliance shouldn&rsquo;t need a full-time hire. We built RealComply so it doesn&rsquo;t.
          </p>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Spend less time wondering what you&rsquo;ve missed.
          </h2>
          {/* Was "We're opening RealComply to a small number of NSW agencies at
              a time. Leave your email and we'll be in touch before the next
              round." Changed 22 Oct 2026 (Adam). The form behind it is still
              the early access list: someone gets in touch to set them up. */}
          <p className="mt-3 text-base text-rc-ink-muted">
            Get set up with RealComply in the time it takes to have a coffee.
          </p>
          <EarlyAccessForm source={src} tone="dark" />
          <p className="mt-4 text-base font-bold tracking-tight text-white">No set-up fee. No lock-in contracts.</p>
        </div>
      </section>

      {/* The disclaimer keeps its formal register deliberately, against the
          relaxed voice everywhere else. It is liability framing, not tone. */}
      <footer className="bg-rc-panel py-8 text-center text-white">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="mx-auto max-w-xl text-xs leading-relaxed text-rc-ink-muted/80">
            RealComply Pty Ltd. RealComply provides diligence support to help licensees and agents stay on top of
            their compliance obligations. It is not a law firm and does not provide legal advice; it does not
            guarantee compliance. The licensee remains responsible for decisions and sign-off. © 2026 RealComply Pty
            Ltd.
          </p>
          {/* A privacy policy nobody can find is not published. This is the
              only route to it for someone deciding whether to sign up, and for
              a regulator who never will. */}
          <p className="mt-4 text-xs text-rc-ink-muted/80">
            <Link href="/privacy" className="hover:text-white hover:underline">
              Privacy Policy
            </Link>
            <span className="px-2 text-rc-ink-muted/50">·</span>
            <Link href="/terms" className="hover:text-white hover:underline">
              Terms and Conditions
            </Link>
          </p>
        </div>
      </footer>

      {/* Analytics: Plausible, on this public page only, not on authenticated
          app routes. The Meta Pixel is separate and lives in the root layout,
          because Meta needs PageView on every page it might send traffic to. */}
      <MetaPixel />
      <Script defer data-domain="realcomply.com.au" src="https://plausible.io/js/script.js" strategy="afterInteractive" />
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible = window.plausible || function(){(window.plausible.q = window.plausible.q || []).push(arguments)};`}
      </Script>
      <Script id="marketing-tracking" strategy="afterInteractive">
        {`
          document.querySelectorAll('[data-cta]').forEach(function(el){
            el.addEventListener('click', function(){
              window.plausible('CTA Click', { props: { cta: el.getAttribute('data-cta') } });
            });
          });
          (function(){
            var seen = new Set();
            var sections = document.querySelectorAll('[data-section]');
            if (!('IntersectionObserver' in window) || !sections.length) return;
            var observer = new IntersectionObserver(function(entries){
              entries.forEach(function(entry){
                if (entry.isIntersecting) {
                  var name = entry.target.getAttribute('data-section');
                  if (!seen.has(name)) {
                    seen.add(name);
                    window.plausible('Section View', { props: { section: name } });
                  }
                }
              });
            }, { threshold: 0.4 });
            sections.forEach(function(s){ observer.observe(s); });
          })();
        `}
      </Script>
      {/* Vercel Web Analytics (Adam, 29 Oct 2026): public pages only, records
          the page and the ?src= tag and nothing else. See PublicAnalytics.tsx. */}
      <PublicAnalytics />
    </main>
  );
}
