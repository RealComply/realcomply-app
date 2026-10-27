"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { RoofMark } from "@/components/RoofMark";
import { openAnnexureSigning } from "@/lib/actions/sg-annexure";
import { setSetupNotApplicable } from "@/lib/actions/office-setup";
import { groupCounts, type SetupStep } from "@/lib/rules/office-setup";
import { formatAuDayMonth } from "@/lib/format-date";
import type { SetupView } from "@/lib/data/office-setup";

// "Set up your office" at the top of Home (Adam, 27 Oct 2026; mockup
// approved). Kept uncluttered, as Adam asked: the title and "N of N", a
// progress bar, ONE next step with a button straight to the right page, and
// "See every step". Nothing else. The full list is grouped. A person's own
// card ("Set up your profile") is short, so its list shows under the next
// step. Once everything is done the card goes and SetupDoneLine stays.

export function SetupCard({ view }: { view: SetupView }) {
  const [open, setOpen] = useState(false);
  const pct = view.total > 0 ? Math.round((view.done / view.total) * 100) : 0;
  return (
    <section
      aria-label={view.title}
      className="mt-6 rounded-card border border-rc-border bg-white px-4 py-4 shadow-card sm:px-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-rc-ink">{view.title}</h2>
        <span className="text-sm font-extrabold tabular-nums text-rc-ink">
          {view.done} of {view.total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${view.done} of ${view.total} steps done`}
        aria-valuemin={0}
        aria-valuemax={view.total}
        aria-valuenow={view.done}
        className="mt-3 h-3 overflow-hidden rounded-full bg-rc-border"
      >
        <span className="block h-full rounded-full bg-rc-green-deep" style={{ width: `${pct}%` }} />
      </div>

      {view.next && <NextStep step={view.next} />}

      {view.grouped ? (
        <>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="text-sm font-semibold text-rc-green-deep hover:underline"
            >
              {open ? "Hide the steps" : "See every step"}
            </button>
          </div>
          {open && <StepList steps={view.steps} grouped nextKey={view.next?.key ?? null} />}
        </>
      ) : (
        <StepList steps={view.steps} grouped={false} nextKey={view.next?.key ?? null} />
      )}
    </section>
  );
}

/** Once every step is done: one small grey line at the top of Home. */
export function SetupDoneLine({ view }: { view: SetupView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1">
      <p className="text-xs text-rc-muted">
        {view.doneLabel} · all {view.total} steps done ·{" "}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="font-semibold text-rc-green-deep hover:underline"
        >
          {open ? "Hide them" : "See them"}
        </button>
      </p>
      {open && (
        <div className="mt-2 rounded-card border border-rc-border bg-white px-4 py-3 shadow-card">
          <StepList steps={view.steps} grouped={view.grouped} nextKey={null} />
        </div>
      )}
    </div>
  );
}

function NextStep({ step }: { step: SetupStep }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-[1.5px] border-rc-green-deep bg-rc-green-soft px-3.5 py-3">
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="text-[11px] font-bold uppercase tracking-wide text-rc-green-deep">Next step</p>
        <p className="mt-0.5 text-sm font-bold text-rc-ink">{step.title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-rc-muted">{step.waitingOn ?? step.nextLine}</p>
      </div>
      {!step.waitingOn && (
        <div className="flex flex-wrap items-center gap-2">
          <StepButton step={step} />
          {step.notApplicableLabel && <NotApplicableButton step={step} ghost />}
        </div>
      )}
    </div>
  );
}

const BUTTON =
  "inline-flex items-center justify-center whitespace-nowrap rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600";

function StepButton({ step }: { step: SetupStep }) {
  if (step.annexureForm) {
    return (
      <form action={openAnnexureSigning}>
        <button type="submit" className={BUTTON}>
          {step.action}
        </button>
      </form>
    );
  }
  return (
    <Link href={step.href} className={BUTTON}>
      {step.action}
    </Link>
  );
}

function NotApplicableButton({ step, ghost = false, undo = false }: { step: SetupStep; ghost?: boolean; undo?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const { error: e } = await setSetupNotApplicable(step.key, !undo);
            setError(e);
          })
        }
        className={
          undo
            ? "text-xs font-semibold text-rc-muted underline hover:text-rc-ink disabled:opacity-60"
            : ghost
              ? "rounded-full border border-rc-border bg-white px-3.5 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:opacity-60"
              : "rounded-full border border-rc-border bg-white px-2.5 py-1 text-xs font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:opacity-60"
        }
      >
        {pending ? "Saving…" : undo ? "It does apply" : step.notApplicableLabel}
      </button>
      {error && (
        <span role="alert" className="mt-1 text-xs font-medium text-rc-amber-deep">
          {error}
        </span>
      )}
    </span>
  );
}

function StepList({ steps, grouped, nextKey }: { steps: SetupStep[]; grouped: boolean; nextKey: string | null }) {
  if (!grouped) {
    return (
      <ul className="mt-3 space-y-1.5">
        {steps.map((s) => (
          <StepItem key={s.key} step={s} isNext={s.key === nextKey} />
        ))}
      </ul>
    );
  }
  return (
    <div className="mt-2 space-y-3">
      {groupCounts(steps).map((g) => (
        <div key={g.group}>
          <p className="flex justify-between pt-1 text-[11px] font-bold uppercase tracking-wide text-rc-faint">
            <span>{g.label}</span>
            <span className="tabular-nums">
              {g.done} of {g.total}
            </span>
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {g.steps.map((s) => (
              <StepItem key={s.key} step={s} isNext={s.key === nextKey} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function StepItem({ step, isNext }: { step: SetupStep; isNext: boolean }) {
  const na = step.notApplicable;
  return (
    <li
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5 ${
        isNext ? "border-rc-green-deep bg-white" : "border-rc-border bg-rc-bg-alt"
      }`}
    >
      <Dot done={step.done} notApplicable={na !== null} />
      <div className="min-w-0 flex-[1_1_12rem]">
        <p className={`text-sm font-semibold ${step.done ? "text-rc-muted line-through" : "text-rc-ink"}`}>{step.title}</p>
        <p className="text-xs text-rc-muted">
          {na ? (
            <>
              {/* In the words they chose, e.g. "My deposits go into the agency's trust account". */}
              {step.notApplicableLabel ?? "Doesn't apply"} · marked by {na.byName}, {formatAuDayMonth(na.at)}
            </>
          ) : (
            step.waitingOn ?? step.line
          )}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {na ? (
          <NotApplicableButton step={step} undo />
        ) : (
          !step.done &&
          !step.waitingOn && (
            <>
              {step.notApplicableLabel && <NotApplicableButton step={step} />}
              {step.annexureForm ? (
                <form action={openAnnexureSigning}>
                  <button type="submit" className="text-[13px] font-semibold text-rc-green-deep hover:underline">
                    {step.action}
                    <RoofMark />
                  </button>
                </form>
              ) : (
                <Link href={step.href} className="text-[13px] font-semibold text-rc-green-deep hover:underline">
                  {step.action}
                  <RoofMark />
                </Link>
              )}
            </>
          )
        )}
      </div>
    </li>
  );
}

function Dot({ done, notApplicable }: { done: boolean; notApplicable: boolean }) {
  if (notApplicable) {
    return <span aria-label="Doesn't apply" className="h-5 w-5 shrink-0 rounded-full bg-rc-border" />;
  }
  if (done) {
    return (
      <span aria-label="Done" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rc-green-deep text-white">
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  return <span aria-label="To do" className="h-5 w-5 shrink-0 rounded-full border-2 border-rc-border bg-white" />;
}
