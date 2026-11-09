"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertTriangle, Star } from "lucide-react";
import { clearMostComparable, setMostComparable, type ComparableActionState } from "@/lib/actions/comparables";
import { setComparablesRecord } from "@/lib/actions/compliance";
import type { Comparable } from "@/lib/data/comparables";
import type { AreaKind } from "@/lib/rules/council-area";
import {
  COMPARISON_FACTORS,
  FACTORS_LABEL,
  FEWER_THAN_THREE_HINT,
  FEWER_THAN_THREE_LABEL,
  INFORMATION_USED_HINT,
  INFORMATION_USED_LABEL,
  MAX_MOST_COMPARABLE,
  MOST_COMPARABLE_LABEL,
  MOST_COMPARABLE_REASON_LABEL,
  TIE_HINT,
  comparablesPrompts,
  factorsLine,
  windowCheck,
  type ComparablesRecord,
} from "@/lib/rules/comparables-rules";

// The 17 November rules on the comparables card (Reg s12C to s12F; 0119):
// where each sale sits against the search area, the 3 most comparable with
// why and the factors weighed, and on the card itself, why fewer than 3 and
// the information used. Every mark here is the agent's: nothing is pre-ticked.

/** What the card knows to check the sales against: metro or not, and the date the months count back from. */
export type ComparablesArea = { kind: AreaKind | null; asAt: string; applies: boolean };

const initial: ComparableActionState = { error: null };

/** Under a sale's facts: recent, earlier, outside, or not known. */
export function WindowTag({ comparable, area }: { comparable: Comparable; area: ComparablesArea | null }) {
  if (!area?.kind) return null;
  const w = windowCheck(comparable, area.kind, area.asAt);
  const tone =
    w.place === "recent"
      ? "text-rc-green-deep"
      : w.place === "earlier"
        ? "text-rc-muted"
        : "text-rc-amber-deep";
  return <p className={`mt-0.5 text-[11px] leading-relaxed ${tone}`}>{w.label}</p>;
}

/** Above the sales: how many are marked, what to look at, and the tie rule. */
export function MostComparableSummary({ comparables, area }: { comparables: Comparable[]; area: ComparablesArea | null }) {
  const marked = comparables.filter((c) => c.mostComparable).length;
  const prompts = area?.kind ? comparablesPrompts(comparables, area.kind, area.asAt) : [];
  return (
    <div className="space-y-1.5 rounded-md border border-rc-border bg-white px-2.5 py-2 text-[11px] leading-relaxed">
      <p className="flex items-center gap-1.5 font-semibold text-rc-ink">
        <Star size={12} className="shrink-0 text-rc-green-deep" aria-hidden="true" />
        <span>
          Marked as the most comparable: {marked} of {MAX_MOST_COMPARABLE}
        </span>
      </p>
      <p className="text-rc-muted">
        Mark a sale &ldquo;Relied on&rdquo;, then mark the 3 most comparable, with why (Reg s12C, s12D(5)).{" "}
        {TIE_HINT}
        {area && !area.applies ? " Asked for from 17 November 2026." : ""}
      </p>
      {prompts.map((p) => (
        <p key={p} className="flex items-start gap-1.5 font-medium text-rc-amber-deep">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{p}</span>
        </p>
      ))}
    </div>
  );
}

/** On a sale relied on: the mark, or the button and the short form that make it. */
export function MostComparableMark({
  propertyId,
  comparable,
  markedCount,
}: {
  propertyId: string;
  comparable: Comparable;
  markedCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);
  const [state, formAction, saving] = useActionState(
    async (prev: ComparableActionState, fd: FormData) => {
      const result = await setMostComparable(propertyId, comparable.id, prev, fd);
      if (!result.error) setOpen(false);
      return result;
    },
    initial,
  );

  if (comparable.weighting !== "relied") return null;

  if (comparable.mostComparable) {
    const factors = factorsLine(comparable.comparisonFactors);
    return (
      <div className="mt-2 rounded-md border border-rc-green-deep/30 bg-white px-2.5 py-2 text-[11px] leading-relaxed">
        <p className="flex items-center gap-1.5 font-semibold text-rc-green-deep">
          <Star size={12} className="shrink-0 fill-current" aria-hidden="true" />
          {MOST_COMPARABLE_LABEL}
        </p>
        {comparable.mostComparableReason && <p className="mt-0.5 text-rc-ink">{comparable.mostComparableReason}</p>}
        {factors && <p className="mt-0.5 text-rc-muted">Comparison factors weighed: {factors}.</p>}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await clearMostComparable(propertyId, comparable.id);
              setClearError(result.error);
            })
          }
          className="mt-1 font-semibold text-rc-muted underline underline-offset-2 transition hover:text-rc-ink disabled:opacity-60"
        >
          Take the mark off
        </button>
        {clearError && (
          <p role="alert" className="mt-1 font-medium text-rc-amber-deep">
            {clearError}
          </p>
        )}
      </div>
    );
  }

  const full = markedCount >= MAX_MOST_COMPARABLE;
  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={full}
          title={full ? "3 sales are marked already. Take the mark off one first." : undefined}
          className="inline-flex items-center gap-1 rounded-full border border-rc-green-deep bg-white px-2.5 py-1 text-[11px] font-semibold text-rc-green-deep transition hover:bg-rc-green-soft disabled:cursor-not-allowed disabled:border-rc-border disabled:text-rc-faint"
        >
          <Star size={11} aria-hidden="true" />
          {MOST_COMPARABLE_LABEL}
        </button>
        {full && <span className="ml-2 text-[11px] text-rc-faint">3 are marked already.</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-rc-green-deep/30 bg-white px-2.5 py-2">
      <label className="block text-[11px] font-semibold text-rc-ink">
        {MOST_COMPARABLE_REASON_LABEL}
        <textarea
          name="mostComparableReason"
          rows={2}
          required
          placeholder="For example: same street, same layout, sold 2 months ago."
          className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm font-normal leading-relaxed text-rc-ink"
        />
      </label>
      <fieldset>
        <legend className="text-[11px] font-semibold text-rc-ink">{FACTORS_LABEL}</legend>
        <div className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2">
          {COMPARISON_FACTORS.map((f) => (
            <label key={f.key} className="flex items-start gap-1.5 text-[11px] leading-snug text-rc-ink">
              <input type="checkbox" name="comparisonFactors" value={f.key} className="mt-0.5 shrink-0 accent-rc-green-deep" />
              <span>{f.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] font-semibold text-rc-muted hover:text-rc-ink">
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Under the sales: the information used and where it came from, and why fewer than 3 (Reg s12C(2), s12F). */
export function ComparablesRecordForm({
  propertyId,
  record,
  markedCount,
}: {
  propertyId: string;
  record: ComparablesRecord;
  markedCount: number;
}) {
  const [saved, setSaved] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: { error: string | null }, fd: FormData) => {
      const result = await setComparablesRecord(propertyId, prev, fd);
      setSaved(!result.error);
      return result;
    },
    { error: null },
  );
  const fewer = markedCount < MAX_MOST_COMPARABLE;
  return (
    <form action={formAction} onChange={() => setSaved(false)} className="space-y-2 rounded-md border border-rc-border bg-white px-2.5 py-2">
      <label className="block text-[11px] font-semibold text-rc-ink">
        {INFORMATION_USED_LABEL}
        <span className="mt-0.5 block font-normal text-rc-faint">{INFORMATION_USED_HINT}</span>
        <textarea
          name="informationUsed"
          rows={2}
          defaultValue={record.informationUsed ?? ""}
          className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm font-normal leading-relaxed text-rc-ink"
        />
      </label>
      {fewer ? (
        <label className="block text-[11px] font-semibold text-rc-ink">
          {FEWER_THAN_THREE_LABEL}
          <span className="mt-0.5 block font-normal text-rc-faint">{FEWER_THAN_THREE_HINT}</span>
          <textarea
            name="fewerThanThreeReason"
            rows={2}
            defaultValue={record.fewerThanThreeReason ?? ""}
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm font-normal leading-relaxed text-rc-ink"
          />
        </label>
      ) : (
        // Kept as it was while 3 are marked, so taking a mark off brings it back.
        <input type="hidden" name="fewerThanThreeReason" value={record.fewerThanThreeReason ?? ""} />
      )}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {saved && !pending && <span className="text-[11px] font-medium text-rc-green-deep">Saved.</span>}
      </div>
      {state.error && (
        <p role="alert" className="text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}
