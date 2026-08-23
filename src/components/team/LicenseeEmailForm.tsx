"use client";

import { useActionState, useState } from "react";
import { saveLicenseeEmail } from "@/lib/actions/team";
import { LicenseeChangeNotice } from "@/components/team/LicenseeChangeNotice";

// Agency-level licensee email, editable after setup.
//
// The signup form asks for this, but only for agencies created after 15 Aug
// 2026 — every existing agency has the column empty, and the sign-off link
// button refuses to issue anything without it. This is where they fill it in,
// and where anyone changes it when the licensee in charge changes.
//
// Licensee-only. It decides where a sign-off request lands, so an agent being
// able to edit it would be a straightforward way to route their own file's
// sign-off to an address they control.

const initial = { error: null as string | null, saved: false, licenseeChanged: false };

export function LicenseeEmailForm({
  current,
  currentName,
  website,
}: {
  current: string | null;
  currentName: string | null;
  website: string | null;
}) {
  const [state, action, pending] = useActionState(saveLicenseeEmail, initial);

  // Shown once per change, and dismissing it is the end of it — nothing is
  // recorded, by design. See LicenseeChangeNotice.
  //
  // Derived rather than set from an effect, and the dismissal is cleared when
  // the form is submitted again. That way a SECOND change of licensee shows the
  // notice again, which matters: each appointment starts its own 5-day clock.
  const [dismissed, setDismissed] = useState(false);
  const showNotice = state.licenseeChanged === true && !dismissed;

  return (
    <>
    {showNotice && <LicenseeChangeNotice onClose={() => setDismissed(true)} />}
    <form
      action={action}
      onSubmit={() => setDismissed(false)}
      className="mt-2 rounded-card border border-rc-border bg-white p-4 shadow-card"
    >
      <label htmlFor="licenseeName" className="block text-sm font-medium text-rc-ink">
        Licensee in charge
      </label>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Who signs off your files, and where the requests are addressed. Used when you create a sign-off link
        for a listing.
      </p>
      <div className="mt-2 space-y-2">
        {/* Name and address together, because the sign-off statement names the
            person who signed and that wording is snapshotted when the link is
            issued. An address alone produces a weaker record. */}
        <input
          id="licenseeName"
          name="licenseeName"
          type="text"
          autoComplete="off"
          defaultValue={currentName ?? ""}
          placeholder="Jane Smith"
          className="w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
        <input
          id="licenseeEmail"
          name="licenseeEmail"
          type="email"
          defaultValue={current ?? ""}
          placeholder="licensee@youragency.com.au"
          className="w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
      </div>

      {/* The agency's public website. Used to find each listing's own page for
          the weekly advertised-price check, so nobody has to paste a URL per
          listing. For an individual agent subscription this is their employing
          agency's site — the listings live there either way. */}
      <label htmlFor="websiteUrl" className="mt-4 block text-sm font-medium text-rc-ink">
        Agency website
      </label>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Where your listings are published. RealComply uses it to find each listing&rsquo;s page and check the
        advertised price against the ESP.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id="websiteUrl"
          name="websiteUrl"
          // NOT type="url" — that makes the browser reject
          // "www.youragency.com.au" before the form is even submitted, with a
          // message we can't reword. The value is normalised server-side
          // instead (lib/normalise-url.ts), which accepts what people
          // actually type.
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={website ?? ""}
          placeholder="cassproperty.com.au"
          className="min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
    </form>
    </>
  );
}
