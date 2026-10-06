"use client";

import { useActionState, useState } from "react";
import { movePmProperty } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";
import {
  PM_ENDED_BY,
  PM_MANAGEMENT_ENDED_REASONS,
  PM_TERMINATION_GROUNDS,
  type PmEndedBy,
  type PmGroundKey,
  type PmManagementEndedReason,
  type PmMove,
} from "@/lib/rules/nsw-pm";
import { PmChoicePills } from "@/components/pm/PmChoicePills";
import { todayInSydney } from "@/components/pm/pm-dates";

// The move buttons on a PM property (brief A9, B1 to B3). One main button per
// group, and in Tenant vacating and Vacant a second, quieter one. Disabled
// until the stages it depends on are complete, with one short line saying
// what is needed. The server checks the same thing again before it moves
// anything.
//
// Every choice follows the PM pattern: options start grey, one turns green
// when chosen, and Confirm applies it.

const initial: ActionState = { error: null };

export type PmMoveOption = { move: PmMove; line: string };

export function PmMoveControl({ propertyId, options }: { propertyId: string; options: PmMoveOption[] }) {
  const [asking, setAsking] = useState<PmMove | null>(null);
  const [state, formAction, pending] = useActionState(movePmProperty.bind(null, propertyId), initial);

  // Close the question once the move has gone through; the page redraws in
  // the new group with its own buttons. Adjusted during render, not in an effect.
  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) setAsking(null);
  }

  if (options.length === 0) return null;

  if (!asking) {
    return (
      <div className="mt-4 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {options.map(({ move, line }) => (
            <button
              key={move.key}
              type="button"
              disabled={line.length > 0}
              onClick={() => setAsking(move)}
              className={
                move.primary
                  ? "rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45"
                  : "rounded-full border border-rc-green-deep bg-white px-4 py-2 text-sm font-semibold text-rc-green-deep transition hover:bg-rc-green-soft disabled:cursor-not-allowed disabled:opacity-45"
              }
            >
              {move.label} →
            </button>
          ))}
        </div>
        {options
          .filter((o) => o.line)
          .map((o) => (
            <p key={o.move.key} className="text-[13px] text-rc-muted">
              {options.length > 1 ? `${o.move.label}: ` : ""}
              {o.line}
            </p>
          ))}
      </div>
    );
  }

  return (
    <MoveForm
      key={asking.key}
      move={asking}
      formAction={formAction}
      pending={pending}
      error={state.error}
      onCancel={() => setAsking(null)}
    />
  );
}

function MoveForm({
  move,
  formAction,
  pending,
  error,
  onCancel,
}: {
  move: PmMove;
  formAction: (formData: FormData) => void;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [endedBy, setEndedBy] = useState<PmEndedBy | null>(null);
  const [ground, setGround] = useState<PmGroundKey | null>(null);
  const [reason, setReason] = useState<PmManagementEndedReason | null>(null);

  const ready =
    move.asks === "vacating"
      ? endedBy === "tenant" || (endedBy === "landlord" && ground !== null)
      : move.asks === "managementEnded"
        ? reason !== null
        : true;
  const dateLabel = move.asks === "managementEnded" ? "Date it ended" : move.date?.label;

  return (
    <form
      action={formAction}
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-3 rounded-card border border-rc-border bg-white px-4 py-3 shadow-card"
    >
      <input type="hidden" name="from" value={move.from} />
      <input type="hidden" name="move" value={move.key} />
      <span className="text-sm font-semibold text-rc-ink">{move.label}</span>
      {dateLabel && (
        <label className="flex items-center gap-2 text-[13px] text-rc-muted">
          {dateLabel}
          <input
            type="date"
            name="date"
            required
            defaultValue={todayInSydney()}
            className="rounded-lg border border-rc-border px-2 py-1 text-[13px] text-rc-ink focus:border-rc-green-deep focus:outline-none"
          />
        </label>
      )}

      {move.asks === "vacating" && (
        <>
          <PmChoicePills
            label="Who is ending the tenancy?"
            options={PM_ENDED_BY}
            value={endedBy}
            onChange={(k) => {
              setEndedBy(k);
              if (k === "tenant") setGround(null);
            }}
            name="endedBy"
          />
          {endedBy === "landlord" && (
            <PmChoicePills
              label="On what ground?"
              options={PM_TERMINATION_GROUNDS}
              value={ground}
              onChange={setGround}
              name="ground"
            />
          )}
          {endedBy === "tenant" && (
            <p className="basis-full text-[13px] text-rc-muted">
              The three termination items and the re-letting exclusion will be marked N/A, noted as &ldquo;Tenant ended it&rdquo;.
            </p>
          )}
        </>
      )}

      {move.asks === "managementEnded" && (
        <PmChoicePills
          label="Why has it ended?"
          options={PM_MANAGEMENT_ENDED_REASONS}
          value={reason}
          onChange={setReason}
          name="reason"
        />
      )}

      {move.newTenancy && (
        <p className="basis-full text-[13px] text-rc-muted">
          Getting a tenant in, Money and move-in and Exit start fresh for the next tenant. Anything left in the
          current tenant&rsquo;s Exit moves to its own section at the top.
        </p>
      )}

      <div className="flex basis-full flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !ready}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full border border-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="basis-full text-xs font-medium text-rc-red">
          {error}
        </p>
      )}
    </form>
  );
}
