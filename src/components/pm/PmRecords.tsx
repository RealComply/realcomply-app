"use client";

import { useActionState, useState, useTransition } from "react";
import { Info } from "lucide-react";
import { addPmRecord, markPetResponseGiven } from "@/lib/actions/pm";
import type { ActionState } from "@/lib/actions/auth";
import { formatAuDate, formatAuDateTimeShort } from "@/lib/format-date";
import {
  PM_EVENT_RECORDS,
  PM_PET_APPLICATION,
  PM_PET_GROUNDS,
  PM_PET_REQUEST,
  pmPetGroundLabel,
  pmPetOutcomeLabel,
  pmPetReplyBy,
  type PmPetGroundKey,
} from "@/lib/rules/nsw-pm";
import { PmChoicePills } from "@/components/pm/PmChoicePills";
import { todayInSydney } from "@/components/pm/pm-dates";

// Things recorded rather than ticked (brief B6, B7). Each press records the
// person and the time, stamped by the database (0053). Nothing here counts
// towards a stage or holds one.

export type PmRecordView = {
  id: string;
  kind: string;
  data: { received?: string; outcome?: string; ground?: string | null };
  byName: string;
  at: string;
  responseByName: string | null;
  responseAt: string | null;
};

const initial: ActionState = { error: null };

function RecordedLine({ r }: { r: Pick<PmRecordView, "byName" | "at"> }) {
  return (
    <span className="text-[12.5px] font-semibold text-rc-green-deep">
      ✓ {r.byName} · {formatAuDateTimeShort(r.at)}
    </span>
  );
}

function InfoToggle({ title, reference }: { title: string; reference: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Legal basis for ${title}`}
        className="mt-px shrink-0 rounded-full p-0.5 text-rc-faint transition hover:text-rc-green-deep"
      >
        <Info size={13} aria-hidden="true" />
      </button>
      {open && <span className="basis-full text-xs text-rc-faint">Legal basis: {reference}</span>}
    </>
  );
}

// ── Stage 4: When it happens, and pet requests ──────────────────────────────

export function PmOngoingRecords({
  propertyId,
  records,
  canRecord,
  note,
  today,
}: {
  propertyId: string;
  records: PmRecordView[];
  /** False before move-in and after move-out: the records show, the buttons do not. */
  canRecord: boolean;
  note: string;
  /** YYYY-MM-DD in Sydney, for the pet reply deadline. */
  today: string;
}) {
  const pets = records.filter((r) => r.kind === "pet_request");
  return (
    <div>
      <p className="px-4 pb-1 pt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-rc-muted">When it happens</p>
      <ul>
        {PM_EVENT_RECORDS.map((row, i) => (
          <EventRow
            key={row.key}
            propertyId={propertyId}
            row={row}
            presses={records.filter((r) => r.kind === row.key)}
            canRecord={canRecord}
            striped={i % 2 === 1}
          />
        ))}
      </ul>

      <div className="border-t border-rc-border px-4 py-3">
        <div className="flex flex-wrap items-start gap-1.5">
          <span className="text-sm font-semibold text-rc-ink">{PM_PET_REQUEST.title}</span>
          <InfoToggle title={PM_PET_REQUEST.title} reference={PM_PET_REQUEST.reference} />
        </div>
        <p className="text-[13px] text-rc-muted">{PM_PET_REQUEST.help}</p>
        {pets.length > 0 && (
          <ul className="mt-2 space-y-2">
            {pets.map((r) => (
              <PetRequestItem key={r.id} propertyId={propertyId} r={r} today={today} canRecord={canRecord} />
            ))}
          </ul>
        )}
        {canRecord && <PetForm propertyId={propertyId} kind="pet_request" />}
      </div>

      <p className="border-t border-rc-border px-4 py-3 text-[13px] text-rc-muted">{note}</p>
    </div>
  );
}

function EventRow({
  propertyId,
  row,
  presses,
  canRecord,
  striped,
}: {
  propertyId: string;
  row: (typeof PM_EVENT_RECORDS)[number];
  presses: PmRecordView[];
  canRecord: boolean;
  striped: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [state, formAction, pending] = useActionState(addPmRecord.bind(null, propertyId), initial);
  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) setAsking(false);
  }
  const last = presses[presses.length - 1];

  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-rc-border px-4 py-3 ${striped ? "bg-rc-bg-alt" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-1.5">
          <span className="text-sm font-semibold text-rc-ink">{row.title}</span>
          <InfoToggle title={row.title} reference={row.reference} />
        </div>
        <p className="text-[13px] text-rc-muted">{row.help}</p>
        {last && (
          <p className="mt-0.5">
            <RecordedLine r={last} />
            {presses.length > 1 && (
              <span className="ml-1.5 text-[12.5px] text-rc-muted">
                ({presses.length} times. Earlier: {presses
                  .slice(0, -1)
                  .reverse()
                  .map((p) => formatAuDateTimeShort(p.at))
                  .join("; ")})
              </span>
            )}
          </p>
        )}
        {state.error && (
          <p role="alert" className="mt-1 text-xs font-medium text-rc-red">
            {state.error}
          </p>
        )}
      </div>
      {canRecord &&
        (asking ? (
          <form action={formAction} className="flex shrink-0 gap-1.5">
            <input type="hidden" name="kind" value={row.key} />
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-3.5 py-1 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="rounded-full border border-rc-green-deep px-3.5 py-1 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="shrink-0 rounded-full border border-rc-green-deep bg-white px-3.5 py-1 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
          >
            Record
          </button>
        ))}
    </li>
  );
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function PetRequestItem({
  propertyId,
  r,
  today,
  canRecord,
}: {
  propertyId: string;
  r: PmRecordView;
  today: string;
  canRecord: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const replyBy = r.data.received ? pmPetReplyBy(r.data.received) : null;
  const left = replyBy ? daysBetween(today, replyBy) : null;

  return (
    <li className="rounded-lg border border-rc-border bg-white px-3 py-2.5">
      <p className="text-[13px] text-rc-ink">
        <b className="font-semibold">Received {formatAuDate(r.data.received)}.</b> {pmPetOutcomeLabel(r.data.outcome ?? "")}
        {r.data.ground ? `: ${pmPetGroundLabel(r.data.ground)}` : ""}
      </p>
      <p className="mt-0.5">
        <RecordedLine r={r} />
      </p>
      {r.responseAt ? (
        <p className="mt-0.5 text-[12.5px] font-semibold text-rc-green-deep">
          ✓ Response given · {r.responseByName} · {formatAuDateTimeShort(r.responseAt)}
        </p>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {replyBy && (
            <span className={`text-[13px] font-semibold ${left !== null && left < 0 ? "text-rc-red" : "text-rc-amber-deep"}`}>
              Reply by {formatAuDate(replyBy)}
              {left !== null &&
                (left > 1 ? ` (${left} days left)` : left === 1 ? " (1 day left)" : left === 0 ? " (today)" : " (passed)")}
            </span>
          )}
          {canRecord && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const res = await markPetResponseGiven(propertyId, r.id);
                  if (res.error) setError(res.error);
                })
              }
              className="rounded-full border border-rc-green-deep bg-white px-3 py-0.5 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft disabled:opacity-60"
            >
              {pending ? "Saving…" : "Response given"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-rc-red">
          {error}
        </p>
      )}
    </li>
  );
}

// ── The pet form, for a tenant's request (Stage 4) or an application (Stage 2) ──

function PetForm({ propertyId, kind }: { propertyId: string; kind: "pet_request" | "pet_application" }) {
  const spec = kind === "pet_request" ? PM_PET_REQUEST : PM_PET_APPLICATION;
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [ground, setGround] = useState<PmPetGroundKey | null>(null);
  const [state, formAction, pending] = useActionState(addPmRecord.bind(null, propertyId), initial);

  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (!pending && !state.error) {
      setOpen(false);
      setOutcome(null);
      setGround(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-full border border-rc-green-deep bg-white px-3.5 py-1 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
      >
        {kind === "pet_request" ? "Record a pet request" : "Record"}
      </button>
    );
  }

  const refused = outcome === spec.refusedKey;
  const ready = outcome !== null && (!refused || ground !== null);

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-3 rounded-lg border border-rc-border bg-white px-3 py-3">
      <input type="hidden" name="kind" value={kind} />
      {kind === "pet_request" && (
        <label className="flex items-center gap-2 text-[13px] text-rc-muted">
          Date received
          <input
            type="date"
            name="received"
            required
            defaultValue={todayInSydney()}
            className="rounded-lg border border-rc-border px-2 py-1 text-[13px] text-rc-ink focus:border-rc-green-deep focus:outline-none"
          />
        </label>
      )}
      <PmChoicePills
        label="Outcome"
        options={spec.outcomes}
        value={outcome}
        onChange={(k) => {
          setOutcome(k);
          if (k !== spec.refusedKey) setGround(null);
        }}
        name="outcome"
      />
      {refused && (
        <PmChoicePills label="Ground relied on" options={PM_PET_GROUNDS} value={ground} onChange={setGround} name="ground" />
      )}
      <div className="flex basis-full gap-2">
        <button
          type="submit"
          disabled={!ready || pending}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="basis-full text-xs font-medium text-rc-red">
          {state.error}
        </p>
      )}
    </form>
  );
}

// ── Stage 2: Pet on the application ────────────────────────────────────────

export function PmPetApplication({
  propertyId,
  records,
  canRecord,
}: {
  propertyId: string;
  records: PmRecordView[];
  canRecord: boolean;
}) {
  return (
    <div className="border-t border-rc-border px-4 py-3">
      <p className="text-sm font-semibold text-rc-ink">{PM_PET_APPLICATION.title}</p>
      <p className="text-[13px] text-rc-muted">{PM_PET_APPLICATION.help}. Not counted in this stage.</p>
      {records.length > 0 && (
        <ul className="mt-2 space-y-2">
          {records.map((r) => (
            <li key={r.id} className="rounded-lg border border-rc-border bg-white px-3 py-2">
              <p className="text-[13px] text-rc-ink">
                {pmPetOutcomeLabel(r.data.outcome ?? "")}
                {r.data.ground ? `: ${pmPetGroundLabel(r.data.ground)}` : ""}
              </p>
              <p className="mt-0.5">
                <RecordedLine r={r} />
              </p>
            </li>
          ))}
        </ul>
      )}
      {canRecord && <PetForm propertyId={propertyId} kind="pet_application" />}
    </div>
  );
}
