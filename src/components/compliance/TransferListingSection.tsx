"use client";

import { useActionState, useState } from "react";
import { UserRoundCog } from "lucide-react";
import { transferListing } from "@/lib/actions/properties";
import type { ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

export type TransferAgent = { id: string; name: string };

// Moving a listing to another agent. Licensee only — gated by the caller (see
// [id]/page.tsx, the same pattern as every other licensee-only control here),
// re-checked in the Server Action, and enforced for real by the trigger in
// migration 0034, which is also what writes the transfer to the log.
//
// Collapsed by default and shown with the current agent named, because the
// question a licensee actually has in front of a file is "who has this now",
// and the answer should be readable without opening anything.
//
// Not in the danger zone. Handing a file to a colleague is ordinary agency
// business — someone goes on leave, someone leaves — and dressing it in red
// would suggest it is something to avoid rather than something to do properly.
export function TransferListingSection({
  propertyId,
  currentAgentName,
  agents,
}: {
  propertyId: string;
  currentAgentName: string;
  agents: TransferAgent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const boundAction = transferListing.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="mt-6 rounded-card border border-rc-border bg-white p-5">
      <p className="text-sm font-semibold text-rc-ink">Agent on this listing</p>
      <p className="mt-1 text-sm text-rc-muted">
        <span className="font-medium text-rc-ink">{currentAgentName}</span> holds this file. Moving it changes who
        signs, whose weekly summary it appears in, and which assistants can see it.
      </p>

      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink"
        >
          <UserRoundCog size={13} />
          Move to another agent…
        </button>
      ) : agents.length === 0 ? (
        <p className="mt-3 text-sm text-rc-muted">
          There&rsquo;s nobody else in the office to move it to yet. Invite an agent from Team settings first.
        </p>
      ) : (
        <form action={formAction} className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-rc-ink">
            Move to
            <select
              name="toAgentId"
              required
              defaultValue=""
              className="mt-1 block w-full max-w-xs rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            >
              <option value="" disabled>
                Choose an agent…
              </option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>

          <p className="text-[11px] leading-relaxed text-rc-muted">
            Everything already on the file stays as it is — signatures, evidence and dates are a record of what
            happened and are not rewritten. The move itself is recorded against the file.
          </p>

          {state.error && <p className="text-sm text-rc-red">{state.error}</p>}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pending ? "Moving…" : "Move listing"}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-medium text-rc-muted transition hover:bg-rc-bg-alt"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
