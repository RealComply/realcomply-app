"use client";

import { useActionState, useState } from "react";
import { FileSignature, Landmark } from "lucide-react";
import { recordLicenseeHistoryDate, type HistoryDateState } from "@/lib/actions/licensee";
import { openAnnexureSigning } from "@/lib/actions/sg-annexure";

// The new licensee in charge's two Home cards after a change (0080; mockup
// approved by Adam, 16 Oct 2026).
//
// REVERSAL (Adam, 16 Oct 2026). Was (Adam, 23 Aug 2026): "rather than us
// policing it, all we'll do is have a pop up screen with that clause...";
// RealComply did not record whether Fair Trading was told. Now the new
// licensee in charge is reminded until the date is recorded.

const initial: HistoryDateState = { error: null };

/**
 * "Tell Fair Trading about the change of licensee in charge". From the day of
 * the change until a date is recorded; red after the due date (5 business
 * days, s31(3)).
 */
export function FairTradingCard({
  lineId,
  dueSentence,
  overdue,
  todayIso,
}: {
  lineId: string;
  /** "Due 21 October 2026, 5 business days after you took over on 14 October." */
  dueSentence: string;
  overdue: boolean;
  todayIso: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(recordLicenseeHistoryDate, initial);
  if (state.saved) return null;

  const tone = overdue
    ? "border-rc-red/40 bg-rc-red-soft"
    : "border-rc-amber/40 bg-rc-amber/10";
  const iconTone = overdue ? "bg-white text-rc-red" : "bg-white text-rc-amber-deep";

  return (
    <section aria-labelledby="fair-trading-card" className={`mt-6 rounded-card border px-4 py-4 sm:px-5 ${tone}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
          <Landmark size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="fair-trading-card" className="text-sm font-bold text-rc-ink">
            Tell Fair Trading about the change of licensee in charge
          </h2>
          <p className={`mt-1 text-sm leading-relaxed ${overdue ? "text-rc-red" : "text-rc-ink"}`}>
            {dueSentence} Give your name, licence number and each office you cover.
          </p>
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-3 inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
            >
              I&apos;ve told them: record the date
            </button>
          ) : (
            <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="lineId" value={lineId} />
              <input type="hidden" name="which" value="fair_trading" />
              <label className="grid gap-1 text-xs font-semibold text-rc-ink">
                Date Fair Trading was told
                <input
                  type="date"
                  name="date"
                  defaultValue={todayIso}
                  max={todayIso}
                  required
                  className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Record the date"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-full border border-rc-border bg-white px-4 py-2.5 text-sm font-medium text-rc-muted hover:bg-neutral-100"
              >
                Cancel
              </button>
              {state.error && (
                <p role="alert" className="w-full text-sm font-medium text-rc-amber-deep">
                  {state.error}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * "Adopt the annexure as the new licensee in charge". Until they do, the
 * office can't add new listings; existing listings carry on (0080). "Read
 * and adopt" opens the signing page, as the first adoption did.
 */
export function NewLicenseeAnnexureCard({
  previousAdopter,
  unavailable = false,
}: {
  previousAdopter: string;
  unavailable?: boolean;
}) {
  return (
    <section
      aria-labelledby="new-licensee-annexure"
      className="mt-6 rounded-card border border-rc-amber/40 bg-rc-amber/10 px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-rc-amber-deep">
            <FileSignature size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="new-licensee-annexure" className="text-sm font-bold text-rc-ink">
              Adopt the annexure as the new licensee in charge
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-rc-ink">
              The annexure was adopted by {previousAdopter}. Read it and sign it yourself before the office adds new
              listings. Existing listings carry on as normal.
            </p>
          </div>
        </div>
        <form action={openAnnexureSigning} className="shrink-0">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 sm:w-auto"
          >
            Read and adopt
          </button>
        </form>
      </div>
      {unavailable && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-amber-deep">
          The signing page couldn&rsquo;t be opened just now. Try again in a minute.
        </p>
      )}
    </section>
  );
}
