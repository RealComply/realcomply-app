"use client";

import { useActionState, useState } from "react";
import { addPmProperty } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";
import { AddressAutocomplete } from "@/components/property/NewPropertyForm";
import { PM_ORIGINS, type PmOrigin } from "@/lib/rules/nsw-pm";

// "Add a property" at the top of the PM dashboard (brief A4): the address
// (the same address entry sales uses), one of three choices, the property
// manager, then "+ Add property".
//
// The choices start grey and one turns green when chosen, the pattern every
// choice in PM uses.

const initial: ActionState = { error: null };

export function AddPmPropertyForm({
  people,
  defaultManagerId,
}: {
  people: { id: string; name: string }[];
  defaultManagerId: string;
}) {
  const [state, formAction, pending] = useActionState(addPmProperty, initial);
  const [origin, setOrigin] = useState<PmOrigin | null>(null);
  // Held in state, not left to the select (check, 10 Oct 2026). React resets
  // a form's own fields after every submit, refused or not, so a failed add
  // put the picker back on the default and the retry filed the property under
  // the wrong person, where its real manager can't see it (0058).
  const [managerId, setManagerId] = useState(defaultManagerId);

  return (
    <form action={formAction} className="rounded-card border border-rc-border bg-white px-4 py-4 shadow-card sm:px-5">
      <h2 className="text-sm font-bold text-rc-ink">Add a property</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <AddressAutocomplete />
        <div>
          <label htmlFor="pm-manager" className="block text-sm font-medium text-rc-ink">
            Property manager
          </label>
          <select
            id="pm-manager"
            name="managerId"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-rc-border bg-white px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          >
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <input type="hidden" name="origin" value={origin ?? ""} />
      <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="What kind of property">
        {PM_ORIGINS.map((o) => {
          const on = origin === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setOrigin(o.key)}
              className={`rounded-full border px-4 py-1.5 text-[13px] font-semibold transition ${
                on
                  ? "border-rc-green-deep bg-rc-green-deep text-white"
                  : "border-rc-border bg-rc-bg-alt text-rc-muted hover:text-rc-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
        <button
          type="submit"
          disabled={!origin || pending}
          className="ml-auto rounded-full bg-rc-green-deep px-5 py-2 text-sm font-semibold text-white shadow-glow-green transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
        >
          {pending ? "Adding…" : "+ Add property"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}
