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
// Content is the trimmed MVP shape Adam approved (hero + one proof point +
// a single repeated CTA), not the full 9-section site — deliberately lighter
// on detail (no pricing table, no full feature grid) while the domain is in
// its quiet-launch phase: Adam wants realcomply.com.au live and collecting
// real signups, but doesn't want to hand a competitor (or Jye, the domain's
// previous owner) a full blueprint before there's a client base. See
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

      {/* HERO — single screen, single message, single action */}
      <section className="relative isolate overflow-hidden" data-section="hero">
        <div className="rc-mesh-bg" />
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-rc-green-soft px-3.5 py-1.5 text-xs font-bold text-rc-green-deep">
              <span className="h-2 w-2 rounded-full bg-rc-green-deep" />
              Built by agents, for agents
            </span>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.06] tracking-tight text-rc-ink sm:text-5xl">
              Stay on top of compliance. <span className="text-rc-green-deep">Without a full-time hire.</span>
            </h1>
            <p className="mt-4 max-w-md text-lg text-rc-muted">
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
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-rc-muted">
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

          <div className="rounded-card border border-rc-border bg-white p-5 shadow-card-lg">
            <div className="flex items-center justify-between">
              <span className="text-base font-extrabold">123 Smith Street, Smithtown</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-soft px-3 py-1 text-xs font-bold text-rc-green-deep">
                <span className="h-2 w-2 rounded-full bg-rc-green-deep" />
                On track
              </span>
            </div>
            <p className="mt-0.5 text-xs text-rc-faint">Sales file · NSW · last reviewed today</p>

            <div className="mt-3 divide-y divide-rc-border border-t border-rc-border">
              <div className="flex items-center gap-3 py-3 text-sm">
                <span className="h-2.5 w-2.5 flex-none rounded-full bg-rc-green-deep" />
                Agency agreement read &amp; on file
                <span className="ml-auto text-xs font-bold text-rc-green-deep">Clear</span>
              </div>
              <div className="flex items-center gap-3 py-3 text-sm">
                <span className="h-2.5 w-2.5 flex-none rounded-full bg-rc-green-deep" />
                Price guide matches the estimate
                <span className="ml-auto text-xs font-bold text-rc-green-deep">Clear</span>
              </div>
              <div className="flex items-center gap-3 py-3 text-sm">
                <span className="h-2.5 w-2.5 flex-none rounded-full bg-rc-amber-deep" />
                <span className="font-semibold text-rc-amber-deep">Estimate due for weekly review</span>
                <span className="ml-auto text-xs font-bold text-rc-amber-deep">Look</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ONE proof section — the differentiator, nothing else competing for attention.
          Copy workshopped with Adam 11 Aug 2026: moved off "The difference" (implied a
          competitor that doesn't exist) onto the filing-cabinet/compliance-officer
          contrast he'd already responded to, then further onto a plain assistant-role
          headline once we agreed the explainer paragraph below carries the specifics —
          "personal" does the reassurance work, no absolutes, no invented rival. */}
      <section className="bg-rc-ink-bg py-16 text-white" data-section="proof">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-12">
          <div>
            <div className="text-xs font-extrabold uppercase tracking-widest text-rc-green">What you&rsquo;ve been waiting for</div>
            <h2 className="mt-2.5 text-3xl font-extrabold tracking-tight">Your personal compliance assistant.</h2>
            <p className="mt-4 text-base leading-relaxed text-rc-ink-muted">
              It reads the documents as they land, guides you through each compliance step, and flags anything
              that looks off before settlement. Then it wraps it all into a compliance summary, ready to sign off.
            </p>
          </div>
          <div className="rounded-card border border-rc-ink-line bg-rc-panel p-3 shadow-card-lg">
            <div className="mx-3 mt-3 h-2.5 w-4/5 rounded bg-white/[0.06]" />
            <div className="mx-3 mt-2 h-2.5 w-3/5 rounded bg-white/[0.06]" />
            <div className="m-3 rounded-xl border border-rc-green/30 bg-rc-green/10 p-3.5 text-xs font-semibold leading-relaxed text-rc-green">
              &ldquo;Advertised guide $1,600,000 sits below your estimated selling price of $1,680,000. That reads
              as underquoting. Raise the guide or revise the estimate.&rdquo;
            </div>
            <div className="mx-3 mt-2 h-2.5 w-4/5 rounded bg-white/[0.06]" />
            <div className="mx-3 mt-2 h-2.5 w-full rounded bg-white/[0.06]" />
            <div className="mx-3 mb-3 mt-2 h-2.5 w-3/5 rounded bg-white/[0.06]" />
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
