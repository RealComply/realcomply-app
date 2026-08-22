import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { EarlyAccessForm } from "@/components/EarlyAccessForm";
import { MetaPixel } from "@/components/MetaPixel";

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
//
// The sub-headline is duplicated in three places: here, the openGraph block
// below, and the site-wide fallback in layout.tsx. Change all three together
// or the ad, the search result and the page start disagreeing.

const DESCRIPTION =
  "RealComply is software for NSW real estate agencies. It runs the compliance file for every listing you sell, from the agency agreement through to settlement, and builds the record as you go.";

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

// The three steps. Numbered rather than ticked, because the point is that this
// is a sequence you move through, not three separate benefits.
const STEPS = [
  {
    title: "Add the listing.",
    body: "Give it the address and the basics. It builds the checklist for that property, because a strata unit and a house with a pool don't need the same things.",
  },
  {
    title: "Work the file as you go.",
    body: "Each stage of the sale shows only what's required at that point. Attach the agency agreement and the contract, and it reads what it can rather than asking you to type it again.",
  },
  {
    title: "The record is already there.",
    body: "When your licensee, your adviser or Fair Trading asks what happened on a file, the answer is in the file. Nothing to reconstruct at the end.",
  },
];

// Every one of these states a RESULT. None states a method. That line is the
// whole editorial rule for this band and it is easy to cross by accident: a
// sentence naming what gets compared, what triggers a check, or what the AI
// reads to reach a conclusion has crossed it.
const AI_FEATURES = [
  {
    title: "It reads your paperwork, so you stop retyping it.",
    body: "Attach the agency agreement and the contract. The dates, figures and confirmations already sitting in them come across on their own. You check them instead of transcribing them.",
  },
  {
    title: "It tells you what the contract is missing.",
    body: "Every document that has to be attached is accounted for one by one, and anything it can't find is raised before the property goes to market, not after a buyer's solicitor finds it.",
  },
  {
    title: "It watches your live advertising.",
    body: "Your own listing pages are checked against the estimate on the file every week, and again the moment you revise a price. If what's advertised slips below where it should be, you hear about it that week.",
  },
  {
    title: "It answers questions about the Act.",
    body: "Ask in plain English and get an answer with the section it came from. Seconds, at your desk, instead of making a call and being put on hold.",
  },
];

// Split by who is reading (Adam, 17 Aug 2026). A principal can read their own
// column and stop. Each column is also a sequence rather than three unrelated
// points: the licensee's runs oversight, then approval, then evidence; the
// agent's runs start of the job, middle, then the weekly loop.
const FOR_LICENSEE = [
  {
    title: "You can see the whole office.",
    body: "Every listing, every agent, what's done and what's outstanding, without asking anyone.",
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
    body: "Each listing shows what's left, in the order it's needed.",
  },
  {
    title: "Less retyping.",
    body: "What's already in your agreement doesn't get asked for twice.",
  },
  {
    title: "Every Monday morning.",
    body: "A short list of what's outstanding on your listings lands in your inbox, so you know what needs to be actioned.",
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
          <Link href="/login" className="text-sm font-medium text-rc-muted hover:text-rc-ink" data-cta="nav-login">
            Log in
          </Link>
        </div>
      </header>

      {/* HERO — what it is, then the single ask, above the fold on a phone.
          Most Meta traffic is mobile, so nothing else competes up here. */}
      <section className="relative isolate overflow-hidden" data-section="hero">
        <div className="rc-mesh-bg" />
        <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6 sm:py-20">
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
          <p className="mx-auto mt-4 max-w-lg text-lg text-rc-muted">{DESCRIPTION}</p>

          <EarlyAccessForm source={src} />

          {/* RISK REVERSAL. Adam, 15 Aug 2026: "I really want the person who
              lands on the landing page to feel like there is absolutely no
              risk and nothing to lose." Sits directly under the button because
              that is the moment the hesitation happens. */}
          <div className="mx-auto mt-5 max-w-md rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-5 py-4">
            <p className="text-base font-extrabold leading-snug tracking-tight text-rc-green-deep-600 sm:text-lg">
              No set-up fee. No lock-in contracts.
            </p>
          </div>

          {/* "The licensee stays in charge" became "You always have the final
              say" (17 Aug 2026). The old wording answered an objection a
              first-time reader has not had yet, which plants a worry rather
              than settling one. Same promise, read as reassurance. */}
          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-semibold text-rc-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              Grounded in NSW legislation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              You always have the final say
            </span>
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
            licensee is personally on the hook for every file in the office, and for most, the honest system is a
            spreadsheet, a folder, and a good memory.
          </p>
          <p className="mt-4 text-lg font-semibold leading-relaxed text-rc-ink">
            RealComply exists to close that gap. Getting compliance right shouldn&rsquo;t depend on how many people you
            employ.
          </p>
        </div>
      </section>

      {/* HOW IT WORKS — the band the page never had. Three steps, no screens,
          no worked example, nothing about what is checked. */}
      <section className="border-t border-rc-border py-16 sm:py-20" data-section="how">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">How it works</h2>
          <div className="mt-9 grid gap-5 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="rounded-card border border-rc-border bg-white p-6 shadow-card">
                <div
                  className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-sm font-extrabold text-rc-green-deep"
                  style={{ background: "var(--rc-badge-grad-green)" }}
                  aria-hidden="true"
                >
                  {i + 1}
                </div>
                <h3 className="text-base font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-rc-muted">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* THE AI — added 17 Aug 2026 when Adam reversed the say-nothing
          decision. The opening line is the competitive argument in two
          sentences, and it is true of every tracker in this market. */}
      <section
        className="border-t border-rc-border py-16 sm:py-20"
        style={{ background: "linear-gradient(180deg,#f7fdfa 0%,#ffffff 100%)" }}
        data-section="ai"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="max-w-xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            The part that does the work for you
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-rc-muted">
            Most compliance software gives you a better checklist. RealComply reads the documents you already have and
            does something with them.
          </p>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {AI_FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-card border border-rc-border border-l-[3px] border-l-rc-green-deep bg-white p-6 shadow-card"
              >
                <h3 className="text-[17px] font-bold leading-snug tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-rc-muted">{f.body}</p>
              </div>
            ))}
          </div>
          {/* Once the page claims the AI does real work, this stops it reading
              as "the software decides". It is the liability posture and, for a
              licensee, the reassurance that makes the rest safe to want. */}
          <p className="mt-7 max-w-xl text-sm leading-relaxed text-rc-faint">
            You stay the decision-maker throughout. Everything it finds is put to you, and nothing is signed off in your
            name.
          </p>
        </div>
      </section>

      {/* WHAT CHANGES DAY TO DAY. data-section kept as "outcomes" on purpose —
          renaming it would break continuity with the Plausible history from
          the previous version of this band. */}
      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="outcomes">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Compliance on track. Your time back to do what you do best.
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
          <p className="mt-3 text-base text-rc-ink-muted">
            We&rsquo;re opening RealComply to a small number of NSW agencies at a time. Leave your email and we&rsquo;ll
            be in touch before the next round.
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
              Terms of Service
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
    </main>
  );
}
