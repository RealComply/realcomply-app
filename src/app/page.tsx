import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { EarlyAccessForm } from "@/components/EarlyAccessForm";

// The public landing page, restored 13 Aug 2026 as the destination for Meta
// ads. It had been deleted on 12 Aug in favour of a bare redirect to /login,
// on the reasoning that there was no audience to pitch and no reason to show
// the product to Jye (the domain's previous owner) or any other competitor
// before there was a client base. Paying for clicks reverses that: a visitor
// who lands on a login form has nothing to read and nothing to do.
//
// HOW MUCH THIS SAYS is a deliberate middle setting, chosen by Adam: describe
// the outcomes, not the mechanics. No screenshots, no worked underquoting
// example, nothing showing how the reasoning is done — the things that would
// hand a competitor a blueprint. What it does say is what an agency gets, so a
// stranger has a reason to act. If this ever feels thin, the lever to pull is
// proof (a named agency, a number), not mechanics.
//
// robots: indexable again. The earlier noindex existed to keep the product out
// of sight, which is incompatible with advertising it. Nothing here is secret
// now.
//
// House style, from the brand guidelines: plain English, UK spelling, no
// em-dashes inside sentences, and never a promise of compliance — "diligence
// support", "flags what needs attention", never "guarantees" or "ensures".

export const metadata: Metadata = {
  title: "RealComply — Stay on top of compliance, without a full-time hire",
  description:
    "Compliance support for NSW real estate agencies. Less paperwork, fewer things slipping through, and a clear record of what you have done.",
  openGraph: {
    title: "RealComply — Stay on top of compliance, without a full-time hire",
    description:
      "Compliance support for NSW real estate agencies. Less paperwork, fewer things slipping through, and a clear record of what you have done.",
    url: "https://www.realcomply.com.au",
    siteName: "RealComply",
    locale: "en_AU",
    type: "website",
  },
};

// Outcome-level only. Each of these is something the agency gets, with no
// statement of how it is arrived at.
const OUTCOMES = [
  {
    title: "Know where every listing stands",
    body: "One place that shows what is done, what is still open, and what needs a look. No opening five folders to answer a simple question.",
  },
  {
    title: "Fewer things slipping past you",
    body: "The obligations that carry dates get watched, so a deadline is far less likely to pass without anyone noticing.",
  },
  {
    title: "Your evidence already in order",
    body: "The record builds itself as you work, so if Fair Trading or your adviser asks, the answer is in the file rather than in someone's memory.",
  },
];

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
    <main className="min-h-full bg-white text-rc-ink">
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

      {/* HERO — the promise, then the single ask, above the fold on a phone.
          Most Meta traffic is mobile, so nothing else competes up here. */}
      <section className="relative isolate overflow-hidden" data-section="hero">
        <div className="rc-mesh-bg" />
        <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6 sm:py-20">
          {/* The "Built by agents, for agents" eyebrow pill was removed here
              (Adam, 15 Aug 2026). Taken out rather than reworded: a pill
              containing only a dot is not a design element, it is a leftover.
              The headline now opens the page. */}
          <h1 className="text-4xl font-extrabold leading-[1.06] tracking-tight text-rc-ink sm:text-5xl">
            Stay on top of compliance. <span className="text-rc-green-deep">Without a full-time hire.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-rc-muted">
            Compliance support for NSW agencies. Less paperwork, fewer things slipping through, and a clear record of
            what you have done.
          </p>

          <EarlyAccessForm source={src} />

          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-semibold text-rc-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              Grounded in NSW legislation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              Built inside a working agency
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              The licensee stays in charge
            </span>
          </div>
        </div>
      </section>

      {/* WHAT YOU GET — outcomes only. Deliberately no screens and no worked
          example; see the file-level note. */}
      <section className="border-t border-rc-border bg-rc-bg-alt py-16 sm:py-20" data-section="outcomes">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="mx-auto max-w-xl text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            The paperwork still gets done. It just stops eating your week.
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {OUTCOMES.map((o) => (
              <div
                key={o.title}
                className="rounded-card border border-rc-border bg-white p-6 shadow-card"
              >
                <div
                  className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: "var(--rc-badge-grad-green)" }}
                  aria-hidden="true"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0ca678" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                </div>
                <h3 className="text-base font-bold tracking-tight">{o.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-rc-muted">{o.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL — the same ask, once more, plainly. */}
      <section
        className="relative isolate overflow-hidden bg-rc-ink-bg py-20 text-center text-white"
        data-section="final"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            Spend less time wondering what you have missed.
          </h2>
          <p className="mt-3 text-base text-rc-ink-muted">
            We are opening RealComply to a small number of NSW agencies at a time. Leave your email and we will be in
            touch before the next round.
          </p>
          <EarlyAccessForm source={src} tone="dark" />
        </div>
      </section>

      <footer className="bg-rc-panel py-8 text-center text-white">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="mx-auto max-w-xl text-xs leading-relaxed text-rc-ink-muted/80">
            RealComply Pty Ltd. RealComply provides diligence support to help licensees and agents stay on top of
            their compliance obligations. It is not a law firm and does not provide legal advice; it does not
            guarantee compliance. The licensee remains responsible for decisions and sign-off. © 2026 RealComply Pty
            Ltd.
          </p>
        </div>
      </footer>

      {/* Analytics: Plausible, on this public page only, not on authenticated
          app routes. The Meta Pixel is separate and lives in the root layout,
          because Meta needs PageView on every page it might send traffic to. */}
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
