"use client";

import { useActionState, useState } from "react";
import { setPmRecordsSystem } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";

// Where the office keeps its PM records (brief A1). Named once per agency, free
// text ("PropertyMe"), with a Change link. Nothing is asked per item.

const initial: ActionState = { error: null };

// Licensee only (Adam, 9 Oct 2026): the PM records system is an agency
// detail. Everyone else sees it, read only.
export function RecordsSystemSetting({
  agencyName,
  current,
  canChange,
}: {
  agencyName: string;
  current: string | null;
  canChange: boolean;
}) {
  const [editing, setEditing] = useState(!current && canChange);
  const [state, formAction, pending] = useActionState(setPmRecordsSystem, initial);

  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) setEditing(false);
  }

  if (!editing) {
    return (
      <p className="mt-1 text-sm text-rc-muted">
        {current ? (
          <>
            {agencyName}. Records are kept in <b className="font-semibold text-rc-ink">{current}</b>.
          </>
        ) : (
          <>{agencyName}. The licensee hasn&rsquo;t named the records system yet.</>
        )}{" "}
        {canChange && (
          <button type="button" onClick={() => setEditing(true)} className="font-semibold text-rc-green-deep hover:underline">
            Change
          </button>
        )}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-1 flex flex-wrap items-center gap-2 text-sm text-rc-muted">
      <label htmlFor="pm-records">{agencyName}. Where are your property management records kept?</label>
      <input
        id="pm-records"
        name="recordsSystem"
        defaultValue={current ?? ""}
        required
        maxLength={80}
        placeholder="For example PropertyMe"
        className="w-48 rounded-lg border border-rc-border bg-white px-2.5 py-1 text-sm text-rc-ink focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3.5 py-1 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        Save
      </button>
      {current && (
        <button type="button" onClick={() => setEditing(false)} className="text-[13px] font-semibold text-rc-muted hover:text-rc-ink">
          Cancel
        </button>
      )}
      {state.error && (
        <span role="alert" className="basis-full text-xs font-medium text-rc-red">
          {state.error}
        </span>
      )}
    </form>
  );
}
