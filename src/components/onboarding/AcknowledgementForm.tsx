"use client";

import { useActionState, useState } from "react";
import { confirmAgentAcknowledgement, type AckState } from "@/lib/actions/agent-acknowledgement";
import { ACK_LABELS, ACK_LIMITS, ACK_STATEMENTS, ackProblem } from "@/lib/agent-acknowledgement";

// The "Before you start" form (job 7 brief, Part 1; mockup tab 1). The button
// stays grey until every box is ticked and every field is filled; the server
// checks the same again. A double click saves once: the button is disabled
// while it saves, and the database keeps one per person (0071).

const initial: AckState = { error: null };

const INPUT =
  "mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";
const PREFILLED = `${INPUT} bg-rc-green-soft`;

export function AcknowledgementForm({
  agencyName,
  licenseeName,
  licenseeLicenceNumber,
  date,
}: {
  agencyName: string;
  licenseeName: string;
  /** Pre-filled when known; otherwise typed. */
  licenseeLicenceNumber: string;
  /** Today in Sydney, as shown. */
  date: string;
}) {
  const [state, action, pending] = useActionState(confirmAgentAcknowledgement, initial);
  const [fields, setFields] = useState({
    agentLicenceNumber: "",
    agencyName,
    licenseeName,
    licenseeLicenceNumber,
    typedName: "",
  });
  const [ticked, setTicked] = useState<boolean[]>(ACK_STATEMENTS.map(() => false));
  const ready = ackProblem(fields, ticked) === null;

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form action={action} className="mt-6 grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.agentLicence}</span>
          <input
            name="agentLicenceNumber"
            value={fields.agentLicenceNumber}
            onChange={set("agentLicenceNumber")}
            maxLength={ACK_LIMITS.licence}
            autoComplete="off"
            required
            className={INPUT}
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.agency}</span>
          <input
            name="agencyName"
            value={fields.agencyName}
            onChange={set("agencyName")}
            maxLength={ACK_LIMITS.agency}
            required
            className={fields.agencyName === agencyName && agencyName ? PREFILLED : INPUT}
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.licensee}</span>
          <input
            name="licenseeName"
            value={fields.licenseeName}
            onChange={set("licenseeName")}
            maxLength={ACK_LIMITS.name}
            required
            className={fields.licenseeName === licenseeName && licenseeName ? PREFILLED : INPUT}
          />
        </label>
        <label className="block min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.licenseeLicence}</span>
          <input
            name="licenseeLicenceNumber"
            value={fields.licenseeLicenceNumber}
            onChange={set("licenseeLicenceNumber")}
            maxLength={ACK_LIMITS.licence}
            autoComplete="off"
            required
            className={
              fields.licenseeLicenceNumber === licenseeLicenceNumber && licenseeLicenceNumber ? PREFILLED : INPUT
            }
          />
        </label>
      </div>

      <fieldset className="grid gap-3">
        <legend className="sr-only">Confirm each of these</legend>
        {ACK_STATEMENTS.map((runs, i) => (
          <label
            key={i}
            className="flex cursor-pointer items-start gap-3 rounded-xl bg-rc-bg-alt p-3 text-sm leading-relaxed text-rc-ink"
          >
            <input
              type="checkbox"
              name={`tick${i}`}
              value="yes"
              checked={ticked[i]}
              onChange={(e) => setTicked((prev) => prev.map((t, n) => (n === i ? e.target.checked : t)))}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--rc-green-deep)]"
            />
            <span>
              {runs.map((run, n) => (run.italic ? <em key={n}>{run.text}</em> : <span key={n}>{run.text}</span>))}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.typedName}</span>
          <input
            name="typedName"
            value={fields.typedName}
            onChange={set("typedName")}
            maxLength={ACK_LIMITS.typedName}
            autoComplete="name"
            required
            className={INPUT}
          />
        </label>
        <div className="min-w-0">
          <span className="block text-xs font-semibold text-rc-muted">{ACK_LABELS.date}</span>
          <p className="mt-1 rounded-lg border border-rc-border bg-rc-green-soft px-3 py-2 text-sm text-rc-ink">{date}</p>
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-rc-red">
          {state.error}
        </p>
      )}

      <div>
        <button
          type="submit"
          disabled={!ready || pending}
          className="inline-flex w-full items-center justify-center rounded-full bg-rc-green-deep px-6 py-3 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-faint disabled:opacity-60 sm:w-auto"
        >
          {pending ? "Saving…" : ACK_LABELS.button}
        </button>
        {!ready && (
          <p className="mt-2 text-xs text-rc-muted">
            The button stays grey until every box is ticked and every field is filled.
          </p>
        )}
      </div>
    </form>
  );
}
