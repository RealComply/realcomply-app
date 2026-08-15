"use client";

import { useActionState } from "react";
import { Building2 } from "lucide-react";
import { updateCorporationLicence } from "@/lib/actions/registers";
import { expiryStatus } from "@/lib/expiry-status";
import type { ActionState } from "@/lib/actions/auth";

// The corporation's own licence.
//
// The Licence register listed one card per person and had nowhere for the
// entity's licence, which in NSW is a separate licence the company holds in
// its own right (Adam, 15 Aug 2026: "there's nowhere to put the corporation
// licence"). It sits above the staff cards because it is the licence the
// office trades under — the individuals' licences hang off it, not the other
// way around.
//
// Read-only for an agent, editable by the licensee in charge, matching how
// the insurance policies behave. An agent still needs to see it: they are the
// ones who put the licence number on advertising.

const initial: ActionState = { error: null };

export function CorporationLicenceCard({
  holder,
  licenceNumber,
  expiry,
  agencyName,
  canEdit,
}: {
  holder: string | null;
  licenceNumber: string | null;
  expiry: string | null;
  agencyName: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateCorporationLicence, initial);
  const status = expiryStatus(expiry);

  const statusLabel =
    !expiry
      ? null
      : status === "expired"
        ? { text: "Expired", cls: "bg-rc-red-soft text-rc-red" }
        : status === "urgent"
          ? { text: "Expires within 30 days", cls: "bg-rc-amber/15 text-rc-amber-deep" }
          : { text: "Current", cls: "bg-rc-green-soft text-rc-green-deep" };

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: "var(--rc-badge-grad-green)" }}
            aria-hidden="true"
          >
            <Building2 size={15} strokeWidth={2} color="#0ca678" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-rc-ink">Corporation licence</h3>
            <p className="text-xs text-rc-muted">
              The licence {holder || agencyName} holds as a company, separate from each person&rsquo;s own.
            </p>
          </div>
        </div>
        {statusLabel && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusLabel.cls}`}>
            {statusLabel.text}
          </span>
        )}
      </div>

      {!canEdit ? (
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
          <Read label="Licence holder" value={holder} />
          <Read label="Licence number" value={licenceNumber} />
          <Read label="Expires" value={expiry} />
        </dl>
      ) : (
        <form action={action} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Field name="holder" label="Licence holder" defaultValue={holder ?? ""} placeholder={agencyName} />
          <Field name="licenceNumber" label="Licence number" defaultValue={licenceNumber ?? ""} />
          <Field name="expiry" label="Expires" defaultValue={expiry ?? ""} type="date" />
          <div className="sm:col-span-3">
            {state.error && (
              <p className="mb-2 text-sm font-medium text-rc-amber-deep" role="alert">
                {state.error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-rc-muted">{label}</dt>
      <dd className="text-sm text-rc-ink">{value || <span className="text-rc-faint">Not recorded</span>}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-rc-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
    </label>
  );
}
