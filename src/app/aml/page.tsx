import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Users2, ShieldCheck, FileSearch, ListChecks, ClipboardCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { AmlWaitlistForm } from "@/components/aml/AmlWaitlistForm";

// Standalone AML/CTF waitlist landing page — the MVP test for the AML
// wedge (see the project brief §5: national, one ruleset, brand-new pain
// from Tranche 2, no incumbent). Deliberately a NEW route, additive to the
// existing app: src/app/page.tsx's redirect() to /dashboard or /login is
// untouched. Lives at /aml rather than as a separate static site so it
// deploys through the exact same Vercel pipeline as the product.
//
// Content guardrails (per RealComply-marketing-brief.md §11 and the brand
// voice rules): never say "compliant", "audit-proof", "ensures",
// "guarantees", "never get fined", or "replaces your compliance officer".
// Every claim on this page is worded as diligence support — the licensee
// stays the named, accountable compliance officer. No real client names or
// addresses anywhere on this page, per the same guardrail.

export const metadata: Metadata = {
  title: "RealComply — AML/CTF for real estate agencies",
  description:
    "Tranche 2 AML/CTF reforms brought real estate agencies into scope from 1 July 2026. Join the waitlist for RealComply's AML/CTF module — diligence support for the licensee who stays accountable.",
};

const facts = [
  {
    icon: Clock,
    label: "1 July 2026",
    detail: "Tranche 2 AML/CTF reforms took effect, bringing real estate agencies into scope for the first time.",
  },
  {
    icon: Users2,
    label: "~9,000 agencies",
    detail: "Newly captured nationwide. Most have no program in place and no incumbent compliance tool to turn to.",
  },
  {
    icon: ShieldCheck,
    label: "A named human, always",
    detail: "The law requires a named AML/CTF compliance officer. RealComply supports that person — it doesn't stand in for them.",
  },
];

const moduleItems = [
  {
    icon: FileSearch,
    title: "Risk-aware onboarding",
    body: "Client and matter risk factors tracked against your program, so the questions that matter get asked at the start, not discovered later.",
  },
  {
    icon: ListChecks,
    title: "CDD workflow support",
    body: "Works alongside PEXA Clear for identity verification and screening, and keeps a living record of what's been checked and what's still open.",
  },
  {
    icon: ClipboardCheck,
    title: "A record you can actually show",
    body: "Every file keeps a running, timestamped account of the diligence carried out on it, so a regulator or an auditor sees the trail, not just a tick.",
  },
];

const proof = [
  {
    title: "Built by a working licensee",
    body: "The underlying evidence-and-review engine has been running inside a real NSW agency, on real live files, not built in a vacuum and pitched cold.",
  },
  {
    title: "It doesn't cry wolf",
    body: "The same engine has verified things that were fine and said so, rather than flagging everything to look thorough. A tool that over-flags gets ignored — that's worse than not having one.",
  },
  {
    title: "It reads the documents",
    body: "The wedge is the same for AML as it is for sales compliance: the record is the evidence, not a form someone re-ticks from memory.",
  },
];

export default function AmlLandingPage() {
  return (
    <main className="min-h-full bg-white text-rc-ink">
      <header className="border-b border-rc-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/aml" aria-label="RealComply home">
            <Logo size={19} />
          </Link>
          <Link href="/login" className="text-sm font-medium text-rc-muted hover:text-rc-ink">
            Already a customer? Sign in →
          </Link>
        </div>
      </header>

      <section className="relative isolate overflow-hidden">
        <div className="rc-mesh-bg" />
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rc-green-deep/25 bg-rc-green-soft px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rc-green-deep">
            AML/CTF · Tranche 2 · National
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight text-rc-ink sm:text-5xl">
            The fine does not care that you were busy.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-rc-muted sm:text-lg">
            Tranche 2 pulled real estate agencies into AML/CTF for the first time. RealComply is building the module
            that helps your licensee run the program, not replace them &mdash; a place to see what&rsquo;s done, what&rsquo;s
            outstanding, and the evidence behind it.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="#waitlist"
              className="rounded-full bg-rc-green-deep px-6 py-3 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600"
            >
              Join the waitlist
            </a>
            <span className="text-xs text-rc-faint">Free to join. No card, no commitment.</span>
          </div>
        </div>
      </section>

      <section className="border-t border-rc-border bg-rc-bg-alt py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {facts.map((f) => (
              <div key={f.label} className="rounded-card border border-rc-border bg-white p-5 shadow-card">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-xl text-rc-green-deep"
                  style={{ background: "var(--rc-badge-grad-green)" }}
                >
                  <f.icon size={18} strokeWidth={2.25} />
                </span>
                <p className="mt-3 text-lg font-bold text-rc-ink">{f.label}</p>
                <p className="mt-1 text-sm leading-relaxed text-rc-muted">{f.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight text-rc-ink sm:text-3xl">
            What the AML/CTF module does
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-rc-muted">
            Diligence support for the person who signs. Your named compliance officer decides &mdash; RealComply keeps the
            record and tells you what still needs doing.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {moduleItems.map((m) => (
              <div key={m.title} className="rounded-card border border-rc-border bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-card-hover">
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-rc-green-deep"
                  style={{ background: "var(--rc-badge-grad-green)" }}
                >
                  <m.icon size={20} strokeWidth={2.25} />
                </span>
                <h3 className="mt-4 text-base font-semibold text-rc-ink">{m.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-rc-muted">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-rc-border bg-rc-panel py-16 text-white">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Why this, not another checklist</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {proof.map((p) => (
              <div key={p.title} className="rounded-card border border-white/10 bg-white/5 p-6">
                <h3 className="text-base font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-rc-ink-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight text-rc-ink sm:text-3xl">Two questions everyone asks</h2>
          <div className="mt-8 space-y-4">
            <div className="rounded-card border border-rc-border bg-rc-bg-alt p-5">
              <p className="text-sm font-semibold text-rc-ink">&ldquo;My admin already does this.&rdquo;</p>
              <p className="mt-1.5 text-sm leading-relaxed text-rc-muted">
                Can she read the audit trail against the Act every week, on every file, on top of everything else on her
                desk? RealComply is built to be the thing that actually gets checked, not one more document waiting to be
                opened.
              </p>
            </div>
            <div className="rounded-card border border-rc-border bg-rc-bg-alt p-5">
              <p className="text-sm font-semibold text-rc-ink">&ldquo;What if it&rsquo;s wrong?&rdquo;</p>
              <p className="mt-1.5 text-sm leading-relaxed text-rc-muted">
                You&rsquo;re the licensee. You sign off, and we show you the evidence and the rule behind every prompt so
                you can check it yourself &mdash; this is diligence support, not a substitute for your judgement.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="waitlist" className="border-t border-rc-border bg-rc-bg-alt py-16">
        <div className="mx-auto max-w-xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold tracking-tight text-rc-ink sm:text-3xl">Join the waitlist</h2>
          <p className="mt-3 text-center text-sm text-rc-muted">
            We&rsquo;re opening the AML/CTF module to a small first group before a wider release. Tell us a bit about your
            agency and we&rsquo;ll reach out when there&rsquo;s a spot.
          </p>
          <div className="mt-8">
            <AmlWaitlistForm />
          </div>
        </div>
      </section>

      <footer className="border-t border-rc-border py-10">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <p className="text-xs leading-relaxed text-rc-faint">
            RealComply is diligence support for your agency&rsquo;s compliance program. It does not provide legal advice,
            and it does not replace your agency&rsquo;s named AML/CTF compliance officer, who remains responsible for the
            program and its decisions. Nothing on this page is a guarantee of compliance or of any regulatory outcome.
          </p>
          <div className="mt-6 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <Logo size={16} />
            <p className="text-xs text-rc-faint">Built by agents, for agents.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
