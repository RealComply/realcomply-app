"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { markSgReviewed } from "@/lib/actions/sg-reviews";
import { formatAuDate } from "@/lib/format-date";
import { SG_2_1_2 } from "@/lib/sg-document/fair-trading";
import { REVIEW_NOTE_MAX, REVIEW_SCHEDULE_WORDS, daysUntil, reviewDueTag } from "@/lib/sg-document/annual-review";
import { nextReviewSaid } from "@/lib/sg-document/change-log";

// The annual review (Adam's mockup, signed off 6 Nov 2026, screen 7; 0126):
// for the licensee in charge and every office manager, from 90 days before
// the review is due, on Home and on the supervision guidelines page. Quotes
// Fair Trading's 2.1.2 word for word. A quick amendment, a new version, or
// "Reviewed, no changes needed" (with an optional note) moves the next
// review 12 months on, which takes the card away and stops the reminders.
// Marked reviewed today: a short line saying so, for the rest of the day.

export const REVIEWED_NO_CHANGES = "Reviewed, no changes needed";

export function SgAnnualReviewCard({
  documentId,
  dueOn,
  today,
  reviewedToday,
  onPage = false,
}: {
  documentId: string;
  /** YYYY-MM-DD */
  dueOn: string;
  /** Today in Sydney, YYYY-MM-DD. */
  today: string;
  reviewedToday: boolean;
  /** On the supervision guidelines page: the buttons go to the forms on it. */
  onPage?: boolean;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (reviewedToday) {
    return (
      <p role="status" className="mt-4 max-w-[700px] rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-4 py-3 text-sm text-rc-green-deep">
        Supervision guidelines marked reviewed today, no changes needed. {nextReviewSaid(dueOn)}.
      </p>
    );
  }

  const days = daysUntil(dueOn, today);
  const overdue = days < 0;
  const base = onPage ? "" : "/dashboard/sg-manual";

  return (
    <section
      aria-label="Annual review of your supervision guidelines"
      className="mt-4 max-w-[700px] rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-rc-ink">Annual review of your supervision guidelines</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            overdue ? "bg-red-100 text-red-700" : "border border-rc-amber-deep/30 bg-rc-amber/10 text-rc-amber-deep"
          }`}
        >
          {reviewDueTag(days)}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-rc-ink">
        Your supervision guidelines and operational procedures {overdue ? "were" : "are"} due for review by{" "}
        <strong>{formatAuDate(dueOn)}</strong>.
      </p>
      <blockquote className="mt-3 max-w-[66ch] space-y-1.5 border-l-[3px] border-rc-green-deep py-1 pl-3 text-sm text-rc-ink">
        {SG_2_1_2.paragraphs.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <ul className="list-disc pl-5">
          {SG_2_1_2.areas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <footer className="text-xs text-rc-faint">{SG_2_1_2.source}</footer>
      </blockquote>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`${base}?amend=1#sg-quick-amendment`}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Quick amendment
        </Link>
        <Link
          href={`${base}#sg-upload`}
          className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep"
        >
          Upload new version
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await markSgReviewed({ documentId, note });
              if (res.error) setError(res.error);
            });
          }}
          className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:opacity-60"
        >
          {busy ? "Saving…" : REVIEWED_NO_CHANGES}
        </button>
      </div>
      <div className="mt-3 grid gap-1">
        <label htmlFor={`sg-review-note-${documentId}`} className="text-[13px] font-semibold text-rc-ink">
          Note (optional, for &ldquo;{REVIEWED_NO_CHANGES}&rdquo;)
        </label>
        <textarea
          id={`sg-review-note-${documentId}`}
          value={note}
          maxLength={REVIEW_NOTE_MAX}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl border border-rc-border bg-rc-bg-alt px-3 py-2 text-sm text-rc-ink focus:border-rc-green-deep focus:outline-none"
        />
      </div>
      {error && <p className="mt-2 text-sm font-semibold text-rc-red">{error}</p>}
      <p className="mt-2 text-xs leading-relaxed text-rc-muted">
        Any of these moves the next review to 12 months from today and stops these reminders. Sent at {REVIEW_SCHEDULE_WORDS} to the
        licensee in charge and every office manager.
      </p>
    </section>
  );
}
