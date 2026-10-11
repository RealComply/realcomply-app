"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import type { OpenFlag } from "@/lib/data/send-backs";

// A file the licensee sent back, on the listing page (Adam, 12 Oct 2026). The
// licensee reviews and sends back on the emailed sign-off page; this is the
// agent's side: the banner, and the note on each flagged card.
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
 * On a flagged card, above its body: the licensee's note, and the breach
 * prompt where they ticked it. No button of its own (Adam, 12 Oct 2026: two
 * buttons on one card was confusing). The card went back to not done when it
 * was sent back; marking it done the normal way clears this note (0063).
 */
export function FlagNote({ flag }: { flag: OpenFlag }) {
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
      <p className="mt-1.5 text-xs text-rc-muted">Fix it, then mark this card done as usual. That clears this note.</p>
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
        Fix each one and mark it done as usual. Then sign the file again on Settled and send it back for sign-off.
        {stages.length > 1 ? " The cards are on more than one stage." : ""}
      </p>
    </div>
  );
}
