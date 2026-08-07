"use client";

import { useActionState } from "react";
import { joinAmlWaitlist, initialWaitlistState } from "@/lib/actions/waitlist";

const inputClass =
  "mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";

export function AmlWaitlistForm() {
  const [state, formAction, pending] = useActionState(joinAmlWaitlist, initialWaitlistState);

  if (state.status === "success") {
    return (
      <div className="rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-6 py-8 text-center">
        <p className="text-base font-semibold text-rc-green-deep">You&rsquo;re on the list.</p>
        <p className="mt-2 text-sm text-rc-ink">
          We&rsquo;ll be in touch before the AML/CTF module opens. In the meantime, feel free to keep an eye on{" "}
          <a href="mailto:adam@realcomply.com.au" className="font-medium text-rc-green-deep hover:underline">
            adam@realcomply.com.au
          </a>{" "}
          if you have questions sooner.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-card border border-rc-border bg-white p-6 shadow-card-lg sm:p-8">
      {state.status === "error" && state.error && (
        <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="email" className="block text-sm font-medium text-rc-ink">
            Work email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@youragency.com.au" className={inputClass} />
        </div>

        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-rc-ink">
            Your name
          </label>
          <input id="fullName" name="fullName" type="text" className={inputClass} />
        </div>

        <div>
          <label htmlFor="agencyName" className="block text-sm font-medium text-rc-ink">
            Agency name
          </label>
          <input id="agencyName" name="agencyName" type="text" className={inputClass} />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-rc-ink">
            Your role
          </label>
          <select id="role" name="role" defaultValue="" className={inputClass}>
            <option value="" disabled>
              Choose one
            </option>
            <option value="Licensee in charge">Licensee in charge</option>
            <option value="Agent">Agent</option>
            <option value="Property manager">Property manager</option>
            <option value="Other">Other</option>
          </select>
        </div>

        <div>
          <label htmlFor="propertyCountBand" className="block text-sm font-medium text-rc-ink">
            Managed properties (optional)
          </label>
          <select id="propertyCountBand" name="propertyCountBand" defaultValue="" className={inputClass}>
            <option value="">Prefer not to say</option>
            <option value="up to 50">Up to 50</option>
            <option value="51-120">51–120</option>
            <option value="121-250">121–250</option>
            <option value="250+">250+ / multi-office</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-rc-ink">
          Anything specific you&rsquo;re worried about? (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          placeholder="e.g. we still haven't started our AML program, or we're not sure if we're even in scope"
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {pending ? "Joining…" : "Join the waitlist"}
      </button>

      <p className="text-center text-xs text-rc-faint">
        No spam. Just a note when the AML/CTF module opens, from a real licensee, not a mailing list.
      </p>
    </form>
  );
}
