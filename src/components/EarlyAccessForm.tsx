"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { joinEarlyAccess, type EarlyAccessState } from "@/lib/actions/early-access";
import { looksAustralianPhone } from "@/lib/early-access/phone";

// The ask on the landing page. Email plus office name.
//
// Started as one field, one button — Adam's call, 13 Aug 2026: cold traffic
// from a Meta ad will give up an email and not much more, so asking for name
// and agency as well would cost more signups than the extra detail is worth.
//
// Office name added 3 Sep 2026: "i think we should ask for their office name
// too so i can look them up." That is the reason it is REQUIRED rather than
// optional — a field he cannot rely on being filled does not let him look
// anyone up, which was the whole point of adding it.
//
// A first name was considered at the same time and deliberately left out. An
// office name is a business detail a real estate professional gives without
// hesitation; a personal name reads as a form. This is the higher-value half
// of the pair anyway: it tells him the agency, the area and the likely size.
//
// Mobile added 16 Oct 2026 (Adam, with ads running): OPTIONAL, "for a quick
// call to get you set up". It comes after the email, paired with the button
// the way the email used to be, so the button is still the last thing. Phone
// keyboard on a phone. The check is light and only ever a hint: a number that
// doesn't read as Australian is still accepted, and an empty box is fine.
//
// 14-day trial wording (Adam, trial brief 23 Oct 2026): a titled card, First
// name, Office or agency name, Work email, Mobile (optional, for a 10-minute
// walkthrough). Same fields, same action, same early_access row, same ?src=
// in early_access.source and the same notification to Adam as before.

const initial: EarlyAccessState = { ok: false, error: null };

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    plausible?: (...args: unknown[]) => void;
  }
}

export function EarlyAccessForm({ source, tone = "light" }: { source?: string; tone?: "light" | "dark" }) {
  const [state, formAction, pending] = useActionState(joinEarlyAccess, initial);
  const [phoneHint, setPhoneHint] = useState(false);
  // The landing page shows this form twice (top and bottom), so every
  // field's id is unique per form: its visible label then always focuses its
  // own box.
  const uid = `early-access-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

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

  // Three inputs now, so the tone-dependent classes live in one place rather
  // than being copied three times and drifting apart at the first restyle.
  const field = dark
    ? "border-white/15 bg-white/10 text-white placeholder:text-rc-ink-muted focus:border-rc-green focus:ring-rc-green/30"
    : "border-rc-border bg-white text-rc-ink placeholder:text-rc-faint focus:border-rc-green-deep focus:ring-rc-green-deep/20";

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
        {/* Was "You are on the list. We will be in touch before we open the
            next round." (Adam, 23 Oct 2026: it should be about the trial.) */}
        Thanks, your free trial application is in. We&rsquo;ll email you shortly with your invite to start your 14
        days.
      </div>
    );
  }

  // Visible labels above each box from 23 Oct 2026 (trial brief, mockup):
  // the form is now a card with a title, so the boxes say what they are
  // rather than relying on placeholders.
  const label = `mb-1.5 block text-left text-sm font-semibold ${dark ? "text-white/90" : "text-rc-ink"}`;
  const box = `w-full min-w-0 rounded-xl border px-4 py-3 text-base outline-none transition focus:ring-2 ${field}`;

  return (
    <form
      action={formAction}
      className={`mx-auto mt-7 max-w-md rounded-[24px] border p-6 text-left sm:p-7 ${
        dark ? "border-white/15 bg-white/5" : "border-rc-border bg-white shadow-card"
      }`}
    >
      <input type="hidden" name="source" value={source ?? ""} />

      {/* Honeypot. Hidden from people, offered to naive bots. Not display:none,
          which some fillers skip; off-screen with autocomplete disabled and
          removed from the tab order so it never reaches a real visitor.

          RENAMED 23 Oct 2026. It was name="company_website". Chrome's autofill
          reads "company" in a field name as the company box and fills it,
          hidden or not, when a person picks a saved address, so real people
          tripped the trap and their sign-ups were thrown away (Adam's friend,
          23 Oct). The new name means nothing to autofill. Don't give it a name
          containing company, organisation, business, name, email, phone,
          address or website. */}
      <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={`${uid}-hp`}>Leave this empty</label>
        <input id={`${uid}-hp`} name="rc_trap" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {/* Title, no sub-line (Adam, trial brief 23 Oct 2026). Was no title. */}
      <h2 className={`text-xl font-extrabold tracking-tight sm:text-2xl ${dark ? "text-white" : "text-rc-ink"}`}>
        Start your 14-day free trial
      </h2>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor={`${uid}-first-name`} className={label}>
            First name
          </label>
          <input
            id={`${uid}-first-name`}
            name="firstName"
            type="text"
            required
            maxLength={80}
            autoComplete="given-name"
            className={box}
          />
        </div>

        <div>
          <label htmlFor={`${uid}-agency`} className={label}>
            Office or agency name
          </label>
          <input
            id={`${uid}-agency`}
            name="agencyName"
            type="text"
            required
            maxLength={160}
            autoComplete="organization"
            className={box}
          />
        </div>

        <div>
          <label htmlFor={`${uid}-email`} className={label}>
            Work email
          </label>
          <input
            id={`${uid}-email`}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@youragency.com.au"
            className={box}
          />
        </div>

        <div>
          {/* Was "Mobile (optional): for a quick call to get you set up"
              (16 Oct 2026). Still optional, still never a reason to refuse. */}
          <label htmlFor={`${uid}-mobile`} className={label}>
            Mobile{" "}
            <span className={`font-normal ${dark ? "text-white/70" : "text-rc-muted"}`}>
              (optional, if you&rsquo;d like a 10-minute walkthrough)
            </span>
          </label>
          <input
            id={`${uid}-mobile`}
            name="mobile"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={30}
            placeholder="04xx xxx xxx"
            aria-describedby={phoneHint ? `${uid}-mobile-hint` : undefined}
            onBlur={(e) => {
              const v = e.currentTarget.value.trim();
              setPhoneHint(v !== "" && !looksAustralianPhone(v));
            }}
            onChange={() => phoneHint && setPhoneHint(false)}
            className={box}
          />
          {phoneHint && (
            <p id={`${uid}-mobile-hint`} className={`mt-2 text-sm ${dark ? "text-white/70" : "text-rc-muted"}`}>
              That doesn&rsquo;t look like an Australian number. Check it, or leave it blank.
            </p>
          )}
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        data-cta="early-access"
        className="mt-6 w-full rounded-full bg-rc-green-deep px-7 py-3.5 text-base font-bold text-white shadow-glow-green transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {/* "Get early access" until 22 Oct 2026, then "Sign up now", then this
            from 23 Oct (trial brief). Still joins the early access list: Adam
            approves and invites each person from the staff page. There is no
            self-serve sign-up. */}
        {pending ? "Sending…" : "Apply for my free trial"}
      </button>

      {state.error && (
        <p role="alert" className={`mt-2.5 text-sm font-medium ${dark ? "text-rc-amber" : "text-rc-red"}`}>
          {state.error}
        </p>
      )}

      {/* Replaced "We will only use this to contact you about RealComply. You
          can ask us to remove you at any time." (trial brief, 23 Oct 2026). */}
      <p className={`mt-3 text-sm leading-relaxed ${dark ? "text-rc-ink-muted" : "text-rc-muted"}`}>
        Card needed when you start your trial. Cancel before day 14 and you won&rsquo;t be charged. We only contact
        you about RealComply.
      </p>
    </form>
  );
}
