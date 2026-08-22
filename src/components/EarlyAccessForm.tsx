"use client";

import { useActionState, useEffect } from "react";
import { joinEarlyAccess, type EarlyAccessState } from "@/lib/actions/early-access";

// The single ask on the landing page. One field, one button — Adam's call,
// 13 Aug 2026: cold traffic from a Meta ad will give up an email and not much
// more, so asking for name and agency as well would cost more signups than the
// extra detail is worth. Adding them later is a field each here and a column
// each in the table.

const initial: EarlyAccessState = { ok: false, error: null };

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    plausible?: (...args: unknown[]) => void;
  }
}

export function EarlyAccessForm({ source, tone = "light" }: { source?: string; tone?: "light" | "dark" }) {
  const [state, formAction, pending] = useActionState(joinEarlyAccess, initial);

  // Report the conversion once it has actually succeeded, not on click. Meta
  // optimises campaigns against this event, so firing it on submit would train
  // the algorithm on attempts including the failed and duplicate ones, and the
  // spend would follow the wrong people.
  useEffect(() => {
    if (!state.ok) return;
    window.fbq?.("track", "Lead");
    window.plausible?.("Early Access Signup");
  }, [state.ok]);

  const dark = tone === "dark";

  if (state.ok) {
    return (
      <div
        role="status"
        className={`mx-auto mt-7 max-w-md rounded-2xl border px-5 py-4 text-sm font-semibold ${
          dark
            ? "border-white/15 bg-white/10 text-white"
            : "border-rc-green-deep/20 bg-rc-green-soft text-rc-green-deep"
        }`}
      >
        You are on the list. We will be in touch before we open the next round.
      </div>
    );
  }

  return (
    <form action={formAction} className="mx-auto mt-7 max-w-md">
      <input type="hidden" name="source" value={source ?? ""} />

      {/* Honeypot. Hidden from people, offered to naive bots. Not display:none,
          which some fillers skip; off-screen with autocomplete disabled and
          removed from the tab order so it never reaches a real visitor. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="company_website">Company website</label>
        <input id="company_website" name="company_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label htmlFor="early-access-email" className="sr-only">
          Email address
        </label>
        <input
          id="early-access-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@youragency.com.au"
          className={`min-w-0 flex-1 rounded-full border px-5 py-3.5 text-base outline-none transition focus:ring-2 ${
            dark
              ? "border-white/15 bg-white/10 text-white placeholder:text-rc-ink-muted focus:border-rc-green focus:ring-rc-green/30"
              : "border-rc-border bg-white text-rc-ink placeholder:text-rc-faint focus:border-rc-green-deep focus:ring-rc-green-deep/20"
          }`}
        />
        <button
          type="submit"
          disabled={pending}
          data-cta="early-access"
          className="shrink-0 rounded-full bg-rc-green-deep px-7 py-3.5 text-base font-bold text-white shadow-glow-green transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Adding you…" : "Get early access"}
        </button>
      </div>

      {state.error && (
        <p role="alert" className={`mt-2.5 text-sm font-medium ${dark ? "text-rc-amber" : "text-rc-red"}`}>
          {state.error}
        </p>
      )}

      <p className={`mt-3 text-xs ${dark ? "text-rc-ink-muted" : "text-rc-faint"}`}>
        We will only use this to contact you about RealComply. You can ask us to remove you at any time.
      </p>
    </form>
  );
}
