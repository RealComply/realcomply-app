"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import type { OpenFlag, RoundCard } from "@/lib/data/send-backs";
import { sentBackPriceStatementLine } from "@/lib/rules/price-statement";

// A file the licensee sent back, on the listing page (Adam, 12 Oct 2026). The
// licensee reviews and sends back on the emailed sign-off page; this is the
// agent's side: the banner, and the note on each flagged card.
//
// One provider for the page, so every card can find its own flag without the
// listing page threading another prop through each of ItemCard's card kinds.

type SendBackPage = {
  propertyId: string;
  flags: OpenFlag[];
  /** The latest send-back, done and not done, for the list at the top. */
  round: RoundCard[];
  /** b4 goes to the licensee by email, so it can't be marked done here (0066). */
  priceStatementByEmail: boolean;
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
 * Except b4 when it goes by email, which nobody here can mark done: see
 * sentBackPriceStatementLine.
 */
export function FlagNote({ flag }: { flag: OpenFlag }) {
  const byEmail = useContext(SendBackContext)?.priceStatementByEmail ?? false;
  const howToClear =
    sentBackPriceStatementLine(flag.itemKey, byEmail) ??
    "Fix it, then mark this card done as usual. That clears this note.";
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
      <p className="mt-1.5 text-xs text-rc-muted">
        {howToClear}{" "}
        <a href="#send-back-list" className="font-semibold text-rc-ink underline">
          Back to the list
        </a>
      </p>
    </div>
  );
}

const STAGE_NAMES = ["Listing set-up", "Pre-market", "On market", "Campaign", "Sold", "Settled"];

/**
 * The agent's to-do list at the top of the listing, on every stage (Adam,
 * 12 Oct 2026: "listed so that each time you click one, it takes you straight
 * to the card ... and once it's done, you can go back to the top of the page
 * and tick off the next one"). Every card from the latest send-back: done ones
 * ticked, the rest a link straight to the card. When all are done, a link to
 * sign again. Gone once the file has been sent back to the licensee.
 */
export function SendBackBanner() {
  const page = useContext(SendBackContext);
  if (!page || page.round.length === 0) return null;
  const left = page.round.filter((c) => !c.done).length;
  const cardHref = (stage: number, key: string) => `/dashboard/${page.propertyId}?stage=${stage}#card-${key}`;
  // The header's "mark it done" can't be done on b4 when it goes by email,
  // so that card says what to do instead, in the same words as its note.
  const resendLine = (key: string) => sentBackPriceStatementLine(key, page.priceStatementByEmail);

  return (
    <section
      id="send-back-list"
      className="mt-4 scroll-mt-[calc(var(--rc-userbar-h,0px)+150px)] rounded-card border border-rc-amber-deep/30 bg-rc-amber/10 px-4 py-3"
    >
      <h2 className="text-sm font-bold text-rc-ink">Your licensee sent this file back</h2>
      <p className="mt-0.5 text-xs text-rc-muted">
        {left > 0
          ? `${left} of ${page.round.length} card${page.round.length === 1 ? "" : "s"} still to fix. Click one to go straight to it, fix it and mark it done.`
          : "Every card is fixed."}
      </p>
      <ol className="mt-2 space-y-1.5">
        {page.round.map((c) => (
          <li key={c.id} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                c.done ? "bg-rc-green-deep text-white" : "border border-rc-amber-deep/50 bg-white"
              }`}
            >
              {c.done ? "✓" : ""}
            </span>
            <div className="min-w-0">
              {c.done ? (
                <span className="text-rc-muted line-through">{c.label}</span>
              ) : (
                <Link href={cardHref(c.stage, c.itemKey)} className="font-semibold text-rc-ink underline">
                  {c.label}
                </Link>
              )}
              <span className="ml-1.5 text-xs text-rc-muted">{STAGE_NAMES[c.stage] ?? ""}</span>
              {!c.done && <p className="text-xs text-rc-ink">{c.note}</p>}
              {!c.done && resendLine(c.itemKey) && (
                <p className="text-xs text-rc-muted">{resendLine(c.itemKey)}</p>
              )}
              <span className="sr-only">{c.done ? "Done" : "Still to fix"}</span>
            </div>
          </li>
        ))}
      </ol>
      {left === 0 && (
        <Link
          href={cardHref(5, "sign_agent")}
          className="mt-3 inline-block rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
        >
          All fixed. Sign again and send it back
        </Link>
      )}
    </section>
  );
}
