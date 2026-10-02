"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteProperty } from "@/lib/actions/properties";
import type { ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

// Licensee-only — gated by the caller (see [id]/page.tsx, same pattern as
// every other licensee-only control in this app) and re-checked in the
// server action itself and at the RLS level, so this component being
// client-side never becomes the only thing standing between an agent and
// deleting a file. Deliberately inline rather than a modal (no modal
// primitive exists elsewhere in the app) — collapsed by default so it
// can't be triggered by a stray click, and requires typing the exact
// address back before the real submit button is even enabled.
//
// MOVED 3 Oct 2026. This used to sit as a "Danger zone" box at the very foot
// of the property page, on every stage. Adam: "take it off the main page
// altogether so we can declutter it ... it should come under edit listing."
// It now renders only inside the Edit listing box (EditPropertyDetails),
// below Save and Close, so it is one deliberate click further away and no
// longer competes with the compliance cards. Same gate, same typed-address
// confirmation.
export function DeletePropertySection({ propertyId, address }: { propertyId: string; address: string }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const boundAction = deleteProperty.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  const matches = confirmText.trim().toLowerCase() === address.trim().toLowerCase();

  return (
    <div className="mt-5 border-t border-rc-border pt-4">
      <p className="text-sm font-semibold text-rc-red">Delete this property</p>

      {!expanded ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">
            Deleting this property removes its whole compliance record, including every checklist item and
            uploaded document. This can&rsquo;t be undone.
          </p>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rc-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-rc-red transition hover:bg-rc-red-soft"
          >
            <Trash2 size={13} />
            Delete this property…
          </button>
        </>
      ) : (
        <form action={formAction} className="mt-2 space-y-3">
          <p className="text-sm text-rc-ink">
            This permanently deletes <span className="font-semibold">{address}</span> and everything attached to
            it — checklist progress, evidence documents, all of it. Type the address exactly as shown to confirm.
          </p>
          <input
            type="text"
            name="confirmAddress"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={address}
            autoComplete="off"
            className="w-full rounded-lg border border-rc-red/30 px-3 py-2 text-sm transition focus:border-rc-red focus:outline-none focus:ring-2 focus:ring-rc-red-soft"
          />
          {state.error && <p className="text-sm text-rc-red">{state.error}</p>}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!matches || pending}
              className="rounded-full bg-rc-red px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setConfirmText("");
              }}
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
