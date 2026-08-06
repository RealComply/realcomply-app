"use client";

import { useActionState, useState } from "react";
import { updatePiInsurance, type ActionState } from "@/lib/actions/registers";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import type { Agency, Profile } from "@/lib/types";

const initialState: ActionState = { error: null };

export function PiInsuranceCard({ agency, viewerProfile }: { agency: Agency; viewerProfile: Profile }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updatePiInsurance, initialState);
  const status = expiryStatus(agency.pi_expiry);

  return (
    <div className="rounded-lg border border-rc-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-rc-ink">Professional indemnity insurance</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Mandatory condition of every licence in the agency — s22, Property and Stock Agents Act 2002 (NSW).
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPIRY_STATUS_STYLES[status]}`}>
          {EXPIRY_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
        {!editing ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-neutral-600">
              {agency.pi_insurer ? (
                <>
                  <span className="font-medium text-rc-ink">{agency.pi_insurer}</span>
                  {agency.pi_policy_number && <> · {agency.pi_policy_number}</>}
                  {agency.pi_expiry && <> · expires {agency.pi_expiry}</>}
                </>
              ) : (
                "No PI insurance details on file yet."
              )}
            </div>
            {viewerProfile.is_licensee_in_charge && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline"
              >
                Edit
              </button>
            )}
          </div>
        ) : (
          <form
            action={async (formData) => {
              await formAction(formData);
              setEditing(false);
            }}
            className="space-y-2"
          >
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="piInsurer"
                placeholder="Insurer"
                defaultValue={agency.pi_insurer ?? ""}
                className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="text"
                name="piPolicyNumber"
                placeholder="Policy number"
                defaultValue={agency.pi_policy_number ?? ""}
                className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="date"
                name="piExpiry"
                defaultValue={agency.pi_expiry ?? ""}
                className="rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
          </form>
        )}
      </div>
      {!viewerProfile.is_licensee_in_charge && !agency.pi_insurer && (
        <p className="mt-2 text-xs text-neutral-400">Only the licensee in charge can enter these details.</p>
      )}
    </div>
  );
}
