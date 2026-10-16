"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import {
  changeLicenseeInCharge,
  recordLicenseeHistoryDate,
  type ChangeLicenseeState,
  type HistoryDateState,
} from "@/lib/actions/licensee";
import { changeConfirmation, changeHint } from "@/lib/licensee-history";

// "Licensee in charge" in Office profile (0080; mockup approved by Adam, 16
// Oct 2026): who it is, their licence, since when and when Fair Trading was
// told, with the history folded underneath. The current licensee in charge of
// an office can hand the role on from here, and fill in a date left blank.
// Everyone in the office can see it. Office plans only.

export type CurrentLicensee = {
  lineId: string;
  name: string;
  /** "Class 1 licence 20123456 · since 3 February 2025 · Fair Trading told 5 February 2025" */
  details: string;
  startedOn: string | null;
  fairTradingToldOn: string | null;
};

export type HistoryTableRow = {
  id: string;
  name: string;
  from: string;
  to: string;
  fairTradingTold: string;
  recorded: string;
  missingStart: boolean;
  missingFairTrading: boolean;
};

export type Candidate = { id: string; name: string; label: string };

export function LicenseeInChargeCard({
  current,
  rows,
  canChange,
  candidates,
  todayIso,
}: {
  current: CurrentLicensee | null;
  rows: HistoryTableRow[];
  canChange: boolean;
  candidates: Candidate[];
  todayIso: string;
}) {
  const [changing, setChanging] = useState(false);
  // Said after the change, which the page re-renders around: the person who
  // made it is now an agent, so the form itself goes.
  const [doneName, setDoneName] = useState<string | null>(null);

  return (
    <section
      aria-labelledby="licensee-in-charge"
      className="rounded-card border border-rc-border bg-white p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="licensee-in-charge" className="text-base font-bold text-rc-ink">
          Licensee in charge
        </h2>
        <span
          className="rounded-full bg-rc-green-soft px-2.5 py-0.5 text-xs font-semibold text-rc-green-deep"
          title="Property and Stock Agents Act 2002 (NSW), s31(3): Fair Trading must be told within 5 business days."
        >
          s31(3)
        </span>
      </div>

      {doneName && (
        <p role="status" className="mt-3 rounded-xl bg-rc-green-soft px-3 py-2.5 text-sm text-rc-green-deep">
          Done. {doneName} is now licensee in charge. You&apos;re on the team as an agent.
        </p>
      )}

      {changing && canChange && !doneName ? (
        <ChangeForm
          candidates={candidates}
          todayIso={todayIso}
          onCancel={() => setChanging(false)}
          onDone={(name) => {
            setDoneName(name);
            setChanging(false);
          }}
        />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold text-rc-ink">{current?.name ?? "Not recorded"}</p>
              {current && <p className="mt-0.5 text-sm text-rc-muted">{current.details}</p>}
              {canChange && current && (current.startedOn === null || current.fairTradingToldOn === null) && (
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {current.startedOn === null && (
                    <AddDate lineId={current.lineId} which="started" label="Add the start date" todayIso={todayIso} />
                  )}
                  {current.fairTradingToldOn === null && (
                    <AddDate
                      lineId={current.lineId}
                      which="fair_trading"
                      label="Add when Fair Trading was told"
                      todayIso={todayIso}
                    />
                  )}
                </div>
              )}
            </div>
            {canChange && (
              <button
                type="button"
                onClick={() => setChanging(true)}
                className="shrink-0 py-1 text-sm font-semibold text-rc-green-deep hover:underline"
              >
                Change licensee in charge
              </button>
            )}
          </div>

          {rows.length > 0 && (
            <details className="group mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-rc-green-deep hover:underline">
                History ({rows.length})
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-rc-border text-left text-xs font-bold text-rc-muted">
                      <th className="px-2 py-1.5">Licensee in charge</th>
                      <th className="px-2 py-1.5">From</th>
                      <th className="px-2 py-1.5">To</th>
                      <th className="px-2 py-1.5">Fair Trading told</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-rc-border align-top">
                        <td className="px-2 py-2">
                          <span className="font-semibold text-rc-ink">{r.name}</span>
                          <span className="mt-0.5 block text-xs text-rc-muted">{r.recorded}</span>
                        </td>
                        <td className="px-2 py-2 text-rc-ink">
                          {r.from}
                          {canChange && r.missingStart && (
                            <AddDate lineId={r.id} which="started" label="Add" todayIso={todayIso} compact />
                          )}
                        </td>
                        <td className="px-2 py-2 text-rc-ink">{r.to}</td>
                        <td className="px-2 py-2 text-rc-ink">
                          {r.fairTradingTold}
                          {canChange && r.missingFairTrading && (
                            <AddDate lineId={r.id} which="fair_trading" label="Add" todayIso={todayIso} compact />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-rc-muted">
                Each change is kept with who recorded it and when. Nothing here can be deleted.
              </p>
            </details>
          )}
        </>
      )}
    </section>
  );
}

const initialChange: ChangeLicenseeState = { error: null };

function ChangeForm({
  candidates,
  todayIso,
  onCancel,
  onDone,
}: {
  candidates: Candidate[];
  todayIso: string;
  onCancel: () => void;
  onDone: (name: string) => void;
}) {
  const [state, formAction, pending] = useActionState(changeLicenseeInCharge, initialChange);
  useEffect(() => {
    if (state.done) onDone(state.done.name);
  }, [state.done, onDone]);
  const [newId, setNewId] = useState(candidates[0]?.id ?? "");
  const [tookEffect, setTookEffect] = useState(todayIso);
  const [told, setTold] = useState("");
  const [confirming, setConfirming] = useState(false);
  const chosen = candidates.find((c) => c.id === newId) ?? null;

  if (state.done) return null;

  if (candidates.length === 0) {
    return (
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-rc-ink">
          Nobody else on your team has a class 1 licence on file. Add their licence on the Licences and certificates
          register first, then come back here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/registers?tab=licence"
            className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Open the register
          </Link>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-rc-border px-4 py-2 text-sm font-medium text-rc-muted hover:bg-neutral-100"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-3 grid gap-3">
      <h3 className="text-sm font-bold text-rc-ink">Change licensee in charge</h3>
      <label className="grid gap-1.5 text-sm font-semibold text-rc-ink">
        New licensee in charge
        <select
          name="newLicensee"
          value={newId}
          onChange={(e) => {
            setNewId(e.target.value);
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
        >
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="text-xs font-normal text-rc-muted">Only people with a class 1 licence on file are listed.</span>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-rc-ink">
        Date the change took effect
        <input
          type="date"
          name="tookEffect"
          value={tookEffect}
          max={todayIso}
          required
          onChange={(e) => {
            setTookEffect(e.target.value);
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
        />
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-rc-ink">
        Date Fair Trading was told
        <input
          type="date"
          name="fairTradingTold"
          value={told}
          max={todayIso}
          placeholder="Leave blank if not yet"
          onChange={(e) => {
            setTold(e.target.value);
            setConfirming(false);
          }}
          disabled={pending}
          className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
        />
        <span className="text-xs font-normal text-rc-muted">
          Leave blank if not yet. {changeHint(/^\d{4}-\d{2}-\d{2}$/.test(tookEffect) ? tookEffect : null)}
        </span>
      </label>

      {confirming && chosen ? (
        <div role="alertdialog" aria-labelledby="licensee-confirm" className="rounded-xl border border-rc-border bg-neutral-50 px-3 py-2.5">
          <p id="licensee-confirm" className="text-sm text-rc-ink">
            {changeConfirmation(chosen.name)}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Yes, make the change"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-full border border-rc-border px-4 py-2 text-sm font-medium text-rc-muted hover:bg-neutral-100"
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!chosen || !tookEffect}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Save change
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-rc-border px-4 py-2 text-sm font-medium text-rc-muted hover:bg-neutral-100"
          >
            Cancel
          </button>
        </div>
      )}

      {state.error && (
        <p role="alert" className="text-sm font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}

const initialDate: HistoryDateState = { error: null };

/** A blank date on a line, filled in once. */
export function AddDate({
  lineId,
  which,
  label,
  todayIso,
  compact = false,
  submitLabel = "Save",
}: {
  lineId: string;
  which: "started" | "fair_trading";
  label: string;
  todayIso: string;
  compact?: boolean;
  submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(recordLicenseeHistoryDate, initialDate);
  if (state.saved) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${compact ? "ml-1.5 text-xs" : "text-xs"} font-semibold text-rc-green-deep hover:underline`}
      >
        {label}
      </button>
    );
  }
  return (
    <form action={formAction} className="mt-1.5 flex flex-wrap items-center gap-2">
      <input type="hidden" name="lineId" value={lineId} />
      <input type="hidden" name="which" value={which} />
      <input
        type="date"
        name="date"
        defaultValue={todayIso}
        max={todayIso}
        required
        aria-label={which === "started" ? "Start date" : "Date Fair Trading was told"}
        className="rounded-md border border-rc-border bg-white px-2 py-1 text-sm text-rc-ink"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
      {state.error && (
        <span role="alert" className="w-full text-xs font-medium text-rc-amber-deep">
          {state.error}
        </span>
      )}
    </form>
  );
}
