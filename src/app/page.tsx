import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";

// The real marketing home page, now served from this app's own root route
// instead of the separate static file (RealComply-landing-page.html /
// RealComply-landing-page-mvp.html live in the project as reference/export
// copies of this content, not the deployed source of truth any more).
//
// Content is the bare-hook shape Adam approved on 12 Aug 2026 (headline +
// one-line pitch + a single CTA, no mock UI at all) — a further strip-back
// from the earlier "hero + one proof point" MVP. That earlier version's
// hero snapshot card and "personal compliance assistant" proof section
// (with the specific underquoting-example mockup) were cut because they
// showed too concretely how the product reasons — exactly the kind of
// detail Adam doesn't want handing Jye (the domain's previous owner) or
// any other competitor a blueprint before there's a client base. See
// RealComply-brand-and-site-status.md for the fuller background.
//
// robots: noindex/nofollow for the same reason, mirroring the /aml page's
// posture — reachable by anyone with the link, not surfaced by search.
// Revisit once ready to promote in the open (drop this metadata block).
export const metadata: Metadata = {
  title: "RealComply — Stay on top of compliance, without a full-time hire",
  description:
    "RealComply reads your agreements, contracts and records, checks them against NSW Fair Trading requirements, and flags what needs attention.",
  robots: { index: false, follow: false },
};

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

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

      {/* HERO — the whole page. Bare hook: headline, one-line pitch, one CTA,
          no mock UI. See the file-level comment above for why. */}
      <section className="relative isolate overflow-hidden" data-section="hero">
        <div className="rc-mesh-bg" />
        <div className="mx-auto max-w-2xl px-4 py-14 text-center sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-rc-green-soft px-3.5 py-1.5 text-xs font-bold text-rc-green-deep">
            <span className="h-2 w-2 rounded-full bg-rc-green-deep" />
            Built by agents, for agents
          </span>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.06] tracking-tight text-rc-ink sm:text-5xl">
            Stay on top of compliance. <span className="text-rc-green-deep">Without a full-time hire.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-md text-lg text-rc-muted">
            RealComply reads your agreements, contracts and records, checks them against NSW Fair Trading
            requirements, and flags what needs attention.
          </p>
          <a
            href="/signup"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-rc-green-deep px-7 py-3.5 text-base font-bold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
            data-cta="hero-primary"
          >
            Start your free trial
          </a>
          <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm font-semibold text-rc-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              Grounded in NSW legislation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              Up and running in a day
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-rc-green-deep" />
              14-day free trial, no lock-in
            </span>
          </div>
        </div>
      </section>

      {/* FINAL — the same single ask, repeated once, plainly */}
      <section className="relative isolate overflow-hidden bg-rc-ink-bg py-20 text-center text-white" data-section="final">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Spend less time wondering what you&rsquo;ve missed.</h2>
          <p className="mt-3 text-base text-rc-ink-muted">See RealComply read one of your own files, free for 14 days.</p>
          <a
            href="/signup"
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-rc-green-deep px-7 py-3.5 text-base font-bold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
            data-cta="final-cta"
          >
            Start your free trial
          </a>
        </div>
      </section>

      <footer className="bg-rc-panel py-8 text-center text-white">
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="text-xs font-semibold text-rc-ink-muted">Built by agents, for agents.</p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-rc-ink-muted/80">
            RealComply Pty Ltd. RealComply provides diligence support to help licensees and agents stay on top of
            their compliance obligations. It is not a law firm and does not provide legal advice; it does not
            guarantee compliance. The licensee remains responsible for decisions and sign-off. © 2026 RealComply Pty
            Ltd.
          </p>
        </div>
      </footer>

      {/* Analytics: Plausible, scoped to this public marketing page only (not
          loaded on authenticated app routes). data-domain matches the real
          domain this page is meant to be served from once DNS is pointed at
          it. Requires a Plausible account with realcomply.com.au added as a
          site before this records anything. */}
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
