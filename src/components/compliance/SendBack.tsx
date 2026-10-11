"use client";

import { createContext, useActionState, useContext, type ReactNode } from "react";
import Link from "next/link";
import { markChangesMade, type SendBackState } from "@/lib/actions/send-back";
import type { OpenFlag } from "@/lib/data/send-backs";

// A file the licensee sent back, on the listing page (Adam, 12 Oct 2026). The
// licensee reviews and sends back on the emailed sign-off page; this is the
// agent's side: the banner, and the note with "Changes made" on each card.
//
// One provider for the page, so every card can find its own flag without the
// listing page threading another prop through each of ItemCard's card kinds.

type SendBackPage = {
  propertyId: string;
  flags: OpenFlag[];
};

const SendBackContext = createContext<SendBackPage | null>(null);

export function SendBackProvider({ value, children }: { value: SendBackPage; children: ReactNode }) {
  return <SendBackContext.Provider value={value}>{children}</SendBackContext.Provider>;
}

/** This card's open flag, if the licensee sent it back. */
export function useFlagFor(itemKey: string): OpenFlag | null {
  return useContext(SendBackContext)?.flags.find((f) => f.itemKey === itemKey) ?? null;
}

/**
 * On a flagged card, above its body: the licensee's note, the breach prompt
 * where they ticked it, and "Changes made" with an optional reply.
 */
export function FlagNote({ flag }: { flag: OpenFlag }) {
  const page = useContext(SendBackContext);
  const action = markChangesMade.bind(null, page?.propertyId ?? "", flag.id);
  const [state, formAction, pending] = useActionState(action, { error: null } as SendBackState);

  return (
    <div className="mt-3 rounded-md border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2.5 text-sm">
      <p className="font-semibold text-rc-amber-deep">Your licensee sent this back</p>
      <p className="mt-0.5 whitespace-pre-line text-rc-ink">{flag.note}</p>
      {flag.mayBeBreach && (
        <p className="mt-1.5 text-xs text-rc-ink">
          Flagged as a possible breach. If it is, log it in the{" "}
          <Link href="/dashboard/registers?tab=breaches" className="font-semibold underline">
            breach register
          </Link>{" "}
          as well as fixing this card.
        </p>
      )}
      <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
        <input
          name="reply"
          maxLength={1000}
          placeholder="Reply to your licensee (optional)"
          aria-label="Reply to your licensee (optional)"
          className="min-w-0 flex-1 rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-xs text-rc-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Changes made"}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-1 text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </div>
  );
}

/**
 * The top of the listing while cards are still to fix: how many, and where.
 * Everyone who can see the listing sees it.
 */
export function SendBackBanner() {
  const page = useContext(SendBackContext);
  if (!page || page.flags.length === 0) return null;
  const stages = [...new Set(page.flags.map((f) => f.stage))].sort((a, b) => a - b);
  return (
    <div className="mt-4 rounded-card border border-rc-amber-deep/30 bg-rc-amber/10 px-4 py-3 text-sm">
      <p className="font-semibold text-rc-ink">
        The licensee sent this file back: {page.flags.length} card{page.flags.length === 1 ? "" : "s"} to change
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {page.flags.map((f) => (
          <li key={f.id}>
            <Link href={`/dashboard/${page.propertyId}?stage=${f.stage}`} className="text-rc-ink underline">
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-rc-muted">
        Fix each one and press Changes made on it. Then sign the file again on Settled and send it back for sign-off.
        {stages.length > 1 ? " The cards are on more than one stage." : ""}
      </p>
    </div>
  );
}
