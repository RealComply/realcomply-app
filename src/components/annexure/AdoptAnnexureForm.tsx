"use client";

import { useActionState, useState } from "react";
import { adoptAnnexure, type AdoptState } from "@/lib/actions/sg-annexure";
import { SG_ANNEXURE_TICK } from "@/lib/legal/sg-annexure";
import { ENTITY_NAME_HINT, ENTITY_NAME_LABEL, ENTITY_NAME_MAX, formalAgencyName } from "@/lib/agency-names";

// The bottom of the signing page (brief, 14 Oct 2026): Agency, Licence number
// and Date filled in, the licence number left to type when none is on file,
// the full name, the tick, and "Sign and adopt".
//
// The Agency line reads "[licensed entity name] trading as [trading name]",
// and the licensed entity name can be changed here before signing, or left
// blank (brief, 14 Oct 2026, Part 5). Whatever is in the box when they sign
// is saved to the office's Office profile, recorded as changed on the signing
// page by the name signed, and printed on the signed PDF (0070).
//
// A double click signs once. The button is disabled while the first press is
// with the server, and the database records one adoption per link and per
// office and version (0067), so a second press that gets through anyway is
// refused rather than recorded.

const initial: AdoptState = { error: null };

export function AdoptAnnexureForm({
  token,
  agencyName,
  licensedEntityName,
  licenceNumber,
  date,
  preview = false,
}: {
  token: string;
  /** The trading name. */
  agencyName: string;
  /** The office's saved licensed entity name, if any. Editable here. */
  licensedEntityName: string | null;
  /** Null when none is on file: the box is left for them to type. */
  licenceNumber: string | null;
  date: string;
  /** The test email's preview: everything shows, nothing signs. */
  preview?: boolean;
}) {
  const [state, action, pending] = useActionState(adoptAnnexure, initial);
  const [entity, setEntity] = useState(licensedEntityName ?? "");

  if (state.adopted) {
    return (
      <div className="rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-5 py-5" role="status">
        <p className="text-base font-extrabold tracking-tight text-rc-green-deep-600">
          Adopted. Thank you{state.adopted.firstName ? `, ${state.adopted.firstName}` : ""}.
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-rc-muted">
          A signed copy is on its way to your email. Add it to your Supervision Guidelines.
        </p>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      <dl className="grid gap-3 rounded-card border border-rc-border bg-white p-4 sm:grid-cols-3">
        <div className="min-w-0 sm:col-span-3">
          <dt className="text-xs font-semibold text-rc-muted">Agency</dt>
          <dd className="mt-0.5 break-words text-sm font-bold text-rc-ink" aria-live="polite">
            {formalAgencyName({ tradingName: agencyName, licensedEntityName: entity })}
          </dd>
          <label htmlFor="licensedEntityName" className="mt-2.5 block text-xs font-semibold text-rc-muted">
            {ENTITY_NAME_LABEL}
          </label>
          <input type="hidden" name="entityOnPage" value="yes" />
          <input
            id="licensedEntityName"
            name="licensedEntityName"
            type="text"
            maxLength={ENTITY_NAME_MAX}
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            autoComplete="organization"
            placeholder="Leave blank if it is the same as your trading name"
            className="mt-1 w-full max-w-md rounded-lg border border-rc-border px-2.5 py-1.5 text-sm text-rc-ink transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <p className="mt-1 text-xs text-rc-faint">
            {ENTITY_NAME_HINT} Changing it here also changes it in your Office profile.
          </p>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-rc-muted">
            <label htmlFor="licenceNumber">Licence number</label>
          </dt>
          <dd className="mt-0.5">
            {licenceNumber ? (
              <>
                <span className="text-sm font-bold text-rc-ink">{licenceNumber}</span>
                <input type="hidden" name="licenceNumber" value={licenceNumber} />
              </>
            ) : (
              <input
                id="licenceNumber"
                name="licenceNumber"
                type="text"
                required
                maxLength={40}
                autoComplete="off"
                placeholder="Your licence number"
                className="w-full rounded-lg border border-rc-border px-2.5 py-1.5 text-sm text-rc-ink transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
              />
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-rc-muted">Date</dt>
          <dd className="mt-0.5 text-sm font-bold text-rc-ink">{date}</dd>
        </div>
      </dl>

      <label htmlFor="signedName" className="mt-5 block text-sm font-medium text-rc-ink">
        Your full name
      </label>
      <input
        id="signedName"
        name="signedName"
        type="text"
        required
        minLength={2}
        maxLength={120}
        autoComplete="name"
        placeholder="Jane Smith"
        className="mt-1 w-full max-w-sm rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <p className="mt-1.5 text-xs leading-relaxed text-rc-muted">
        Typing your name here acts as your signature, and the date and time are recorded with it.
      </p>

      <label className="mt-5 flex items-start gap-3 rounded-card border border-rc-border bg-white p-4 text-sm leading-relaxed text-rc-ink">
        <input
          type="checkbox"
          name="agree"
          required
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--rc-green-deep)]"
        />
        <span>{SG_ANNEXURE_TICK}</span>
      </label>

      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || preview}
        className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-rc-green-deep px-6 py-3 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Signing…" : "Sign and adopt"}
      </button>
      {preview && (
        <p className="mt-2 text-xs text-rc-muted">This is a preview from a test email. Nothing can be signed here.</p>
      )}
    </form>
  );
}
