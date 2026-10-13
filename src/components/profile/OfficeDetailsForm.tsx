"use client";

import { useActionState, useState } from "react";
import { saveOfficeNames, type OfficeNamesState } from "@/lib/actions/office-profile";
import {
  ENTITY_FROM_LICENCE,
  ENTITY_NAME_HINT,
  ENTITY_NAME_LABEL,
  ENTITY_NAME_MAX,
  TRADING_NAME_HINT,
  TRADING_NAME_LABEL,
} from "@/lib/agency-names";

// Office details in Office profile (brief, 14 Oct 2026; mockup approved):
// the trading name and the licensed entity name. Shown as they are, with a
// plain "Change" to edit both. The licensed entity name says when it was read
// from the corporation licence, and who last changed it and when.
//
// Only rendered editable for the licensee in charge or an agent on their own
// plan; everyone else gets OfficeNamesReadOnly. The database refuses anyone
// else either way.

const initial: OfficeNamesState = { error: null, saved: false };

export function OfficeDetailsForm({
  tradingName,
  licensedEntityName,
  fromLicence,
  lastChange,
}: {
  tradingName: string;
  licensedEntityName: string | null;
  /** The licensed entity name was read from the corporation licence. */
  fromLicence: boolean;
  /** "Changed by Jane Smith, 14 October 2026", or null. */
  lastChange: string | null;
}) {
  const [state, action, pending] = useActionState(saveOfficeNames, initial);
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-rc-ink">Office details</h3>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-rc-green-deep hover:underline"
          >
            Change
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-rc-muted">{TRADING_NAME_LABEL}</dt>
            <dd className="mt-1 break-words rounded-lg border border-rc-border px-3 py-2 text-sm font-medium text-rc-ink">
              {tradingName}
            </dd>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">{TRADING_NAME_HINT}</p>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-rc-muted">
              {ENTITY_NAME_LABEL}
              {fromLicence && licensedEntityName && (
                <span className="ml-1 font-bold text-rc-green-deep">· {ENTITY_FROM_LICENCE}</span>
              )}
            </dt>
            <dd
              className={`mt-1 break-words rounded-lg border border-rc-border px-3 py-2 text-sm font-medium ${
                licensedEntityName ? "text-rc-ink" : "text-rc-faint"
              } ${fromLicence && licensedEntityName ? "bg-rc-green-soft" : ""}`}
            >
              {licensedEntityName ?? "Not recorded"}
            </dd>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">{ENTITY_NAME_HINT}</p>
            {lastChange && <p className="mt-0.5 text-[11px] text-rc-faint">{lastChange}</p>}
          </div>
        </dl>
      ) : (
        <form
          action={async (fd) => {
            await action(fd);
            setEditing(false);
          }}
          className="mt-3 grid gap-4 sm:grid-cols-2"
        >
          <label className="block min-w-0">
            <span className="block text-xs font-semibold text-rc-muted">{TRADING_NAME_LABEL}</span>
            <input
              name="tradingName"
              type="text"
              required
              maxLength={ENTITY_NAME_MAX}
              defaultValue={tradingName}
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
            <span className="mt-1 block text-xs leading-relaxed text-rc-muted">{TRADING_NAME_HINT}</span>
          </label>
          <label className="block min-w-0">
            <span className="block text-xs font-semibold text-rc-muted">{ENTITY_NAME_LABEL}</span>
            <input
              name="licensedEntityName"
              type="text"
              maxLength={ENTITY_NAME_MAX}
              defaultValue={licensedEntityName ?? ""}
              placeholder="Example Holdings Pty Ltd"
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
            <span className="mt-1 block text-xs leading-relaxed text-rc-muted">{ENTITY_NAME_HINT}</span>
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border border-rc-border px-4 py-1.5 text-xs font-medium text-rc-muted hover:bg-rc-bg-alt"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {state.error && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
      {state.saved && !state.error && !editing && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
    </div>
  );
}

/** For everyone who can't change them: an agent in an office, an assistant. */
export function OfficeNamesReadOnly({
  tradingName,
  licensedEntityName,
}: {
  tradingName: string;
  licensedEntityName: string | null;
}) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <h3 className="text-sm font-bold text-rc-ink">Office details</h3>
      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-rc-muted">{TRADING_NAME_LABEL}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-rc-ink">{tradingName}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-rc-muted">{ENTITY_NAME_LABEL}</dt>
          <dd className="mt-0.5 break-words text-sm font-semibold text-rc-ink">
            {licensedEntityName ?? <span className="font-normal text-rc-faint">Not recorded</span>}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-rc-muted">Your licensee in charge looks after these.</p>
    </div>
  );
}
