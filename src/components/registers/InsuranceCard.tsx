"use client";

import { useActionState, useState } from "react";
import { updateInsurancePolicy, type ActionState } from "@/lib/actions/registers";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import type { InsurancePolicyType, Profile } from "@/lib/types";

const initialState: ActionState = { error: null };

// One card per agency-level policy — PI, cyber, iCare workers — generalised
// out of what used to be a PI-only card (Adam, 13 Aug 2026: "separate
// insurance from licences ... make room for cybersecurity insurance,
// professional indemnity insurance, and also iCare workers insurance").
// Same insurer/policy-number/expiry shape for all three; policyType picks
// which agency columns updateInsurancePolicy writes to.
export function InsuranceCard({
  policyType,
  title,
  note,
  insurer,
  policyNumber,
  expiry,
  viewerProfile,
}: {
  policyType: InsurancePolicyType;
  title: string;
  note: string;
  insurer: string | null;
  policyNumber: string | null;
  expiry: string | null;
  viewerProfile: Profile;
}) {
  const [editing, setEditing] = useState(false);
  const boundAction = updateInsurancePolicy.bind(null, policyType);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const status = expiryStatus(expiry);

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-rc-ink">{title}</h3>
          <p className="mt-1 text-xs text-rc-muted">{note}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPIRY_STATUS_STYLES[status]}`}>
          {EXPIRY_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
        {!editing ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-neutral-600">
              {insurer ? (
                <>
                  <span className="font-medium text-rc-ink">{insurer}</span>
                  {policyNumber && <> · {policyNumber}</>}
                  {expiry && <> · expires {expiry}</>}
                </>
              ) : (
                "No details on file yet."
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
                name="insurer"
                placeholder="Insurer"
                defaultValue={insurer ?? ""}
                className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="text"
                name="policyNumber"
                placeholder="Policy number"
                defaultValue={policyNumber ?? ""}
                className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="date"
                name="expiry"
                defaultValue={expiry ?? ""}
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
                className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-rc-muted hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
          </form>
        )}
      </div>
      {!viewerProfile.is_licensee_in_charge && !insurer && (
        <p className="mt-2 text-xs text-rc-faint">Only the licensee in charge can enter these details.</p>
      )}
    </div>
  );
}
