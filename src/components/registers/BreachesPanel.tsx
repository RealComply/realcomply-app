"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  addBreach,
  recordCorrectiveAction,
  recordBreachNotification,
  closeBreach,
  deleteBreach,
  type ActionState,
} from "@/lib/actions/registers";
import type { Breach, Profile, Property } from "@/lib/types";

const initialState: ActionState = { error: null };

// Property and Stock Agents Act 2002 (NSW) s89 — a licensee must notify the
// Secretary in writing within 5 days of becoming aware a trust account has
// become overdrawn. The clock runs from awareness, which is what
// identified_date records, so the register can count it rather than relying
// on someone remembering. Applied to any breach marked notifiable, since
// that's the tightest deadline in scope and erring early is the safe side.
const NOTIFICATION_DEADLINE_DAYS = 5;

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  action_taken: "bg-rc-amber/10 text-rc-amber-deep",
  closed: "bg-rc-green/10 text-rc-green-deep",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  action_taken: "Action taken",
  closed: "Closed",
};

const SEVERITY_STYLES: Record<string, string> = {
  minor: "bg-neutral-100 text-neutral-600",
  material: "bg-rc-amber/10 text-rc-amber-deep",
  serious: "bg-red-100 text-red-700",
};

const CATEGORY_LABELS: Record<string, string> = {
  pricing: "Pricing / underquoting",
  agency_agreement: "Agency agreement",
  material_facts: "Material facts",
  trust_account: "Trust account",
  advertising: "Advertising",
  record_keeping: "Record keeping",
  conduct: "Conduct",
  supervision: "Supervision",
  other: "Other",
};

function daysSince(dateStr: string): number {
  const then = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)));
}

export function BreachesPanel({
  breaches,
  staff,
  properties,
  viewerProfile,
}: {
  breaches: Breach[];
  staff: Profile[];
  properties: Property[];
  viewerProfile: Profile;
}) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState(addBreach, initialState);

  const open = breaches.filter((b) => b.status !== "closed");
  const awaitingAction = breaches.filter((b) => !b.corrective_action && b.status !== "closed");
  const notificationOutstanding = breaches.filter((b) => b.notifiable && !b.notified_date);
  const notificationOverdue = notificationOutstanding.filter(
    (b) => daysSince(b.identified_date) > NOTIFICATION_DEADLINE_DAYS,
  );

  const nameFor = (id: string | null) =>
    id ? staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "—" : "—";
  const addressFor = (id: string | null) => (id ? properties.find((p) => p.id === id)?.address ?? null : null);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile n={open.length} l="Open" bad={open.length > 0} ok={open.length === 0} />
        <Tile
          n={awaitingAction.length}
          l="No corrective action yet"
          bad={awaitingAction.length > 0}
          ok={awaitingAction.length === 0}
        />
        <Tile
          n={notificationOutstanding.length}
          l="Notification outstanding"
          warn={notificationOutstanding.length > 0}
          ok={notificationOutstanding.length === 0}
        />
        <Tile
          n={notificationOverdue.length}
          l={`Past ${NOTIFICATION_DEADLINE_DAYS}-day deadline`}
          bad={notificationOverdue.length > 0}
          ok={notificationOverdue.length === 0}
        />
      </div>

      <div className="mt-4 rounded-card border border-rc-border bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-rc-ink">Breach &amp; corrective-actions register</h3>
            <p className="mt-0.5 text-xs text-rc-muted">
              Supervision Guidelines Requirement 3 — record the non-compliance <em>and</em> what was done about it. A
              breach marked notifiable is tracked against the 5-day notification deadline (s89, trust account
              overdrawn). Diligence support — the licensee decides what&rsquo;s reportable.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline"
          >
            {adding ? "Cancel" : "+ Log a breach"}
          </button>
        </div>

        {adding && (
          <form
            action={async (fd) => {
              await formAction(fd);
              setAdding(false);
            }}
            className="mt-3 space-y-2 rounded-md border border-rc-border p-3"
          >
            <div className="flex flex-wrap gap-2">
              <input
                type="date"
                name="identifiedDate"
                required
                className="rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <select name="category" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select name="severity" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="minor">Minor</option>
                <option value="material">Material</option>
                <option value="serious">Serious</option>
              </select>
            </div>
            <textarea
              name="description"
              placeholder="What happened? (what the non-compliance was, and how it came to light)"
              required
              rows={2}
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select name="agentId" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="">Agent involved (optional)</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name ?? s.email}
                  </option>
                ))}
              </select>
              <select name="propertyId" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="">Link to a property (optional)</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-start gap-2 text-xs text-rc-muted">
              <input type="checkbox" name="notifiable" className="mt-0.5" />
              <span>
                Reportable to NSW Fair Trading — starts the {NOTIFICATION_DEADLINE_DAYS}-day clock from the date above.
                A trust account becoming overdrawn always is (s89).
              </span>
            </label>
            <textarea
              name="notes"
              placeholder="Notes (optional)"
              rows={1}
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
            {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
          </form>
        )}

        <div className="mt-3 space-y-3">
          {breaches.length === 0 ? (
            <p className="text-sm text-rc-muted">No breaches logged.</p>
          ) : (
            breaches.map((b) => (
              <BreachRow
                key={b.id}
                breach={b}
                agentName={nameFor(b.agent_id)}
                address={addressFor(b.property_id)}
                viewerProfile={viewerProfile}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BreachRow({
  breach: b,
  agentName,
  address,
  viewerProfile,
}: {
  breach: Breach;
  agentName: string;
  address: string | null;
  viewerProfile: Profile;
}) {
  const [actioning, setActioning] = useState(false);
  const [actionState, actionForm, actionPending] = useActionState(
    recordCorrectiveAction.bind(null, b.id),
    initialState,
  );
  const [notifyState, notifyForm, notifyPending] = useActionState(
    recordBreachNotification.bind(null, b.id),
    initialState,
  );

  const days = daysSince(b.identified_date);
  const notificationDue = b.notifiable && !b.notified_date;
  const notificationOverdue = notificationDue && days > NOTIFICATION_DEADLINE_DAYS;

  return (
    <div className="rounded-md border border-rc-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-rc-ink">{CATEGORY_LABELS[b.category] ?? b.category}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[b.severity]}`}>
              {b.severity}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status]}`}>
              {STATUS_LABELS[b.status]}
            </span>
            {notificationOverdue && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                Notification {days} days overdue
              </span>
            )}
            {notificationDue && !notificationOverdue && (
              <span className="rounded-full bg-rc-amber/10 px-2 py-0.5 text-[10px] font-medium text-rc-amber-deep">
                Notify within {Math.max(0, NOTIFICATION_DEADLINE_DAYS - days)} day
                {NOTIFICATION_DEADLINE_DAYS - days === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-700">{b.description}</p>
          <p className="mt-1 text-xs text-rc-faint">
            Identified {b.identified_date} ({days}d ago) · {agentName}
            {address && (
              <>
                {" · "}
                <Link href={`/dashboard/${b.property_id}`} className="text-rc-green-deep hover:underline">
                  {address}
                </Link>
              </>
            )}
            {b.notified_date && <> · Fair Trading notified {b.notified_date}</>}
          </p>
          {b.notes && <p className="mt-1 text-xs text-rc-muted">{b.notes}</p>}
        </div>

        <div className="flex shrink-0 gap-2">
          {b.status !== "closed" && !b.corrective_action && (
            <button
              type="button"
              onClick={() => setActioning((v) => !v)}
              className="text-xs font-medium text-rc-green-deep hover:underline"
            >
              {actioning ? "Cancel" : "Record action"}
            </button>
          )}
          {b.status === "action_taken" && viewerProfile.is_licensee_in_charge && (
            <form action={closeBreach.bind(null, b.id)}>
              <button type="submit" className="text-xs text-rc-green-deep hover:underline">
                Close
              </button>
            </form>
          )}
          {viewerProfile.is_licensee_in_charge && (
            <form action={deleteBreach.bind(null, b.id)}>
              <button type="submit" className="text-xs text-rc-faint hover:text-rc-amber-deep">
                Remove
              </button>
            </form>
          )}
        </div>
      </div>

      {b.corrective_action && (
        <div className="mt-2 rounded-md bg-neutral-50 px-3 py-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Corrective action</span>
          <p className="mt-0.5 text-neutral-700">{b.corrective_action}</p>
          {b.corrective_action_date && <p className="mt-0.5 text-xs text-rc-faint">{b.corrective_action_date}</p>}
        </div>
      )}

      {actioning && (
        <form
          action={async (fd) => {
            await actionForm(fd);
            setActioning(false);
          }}
          className="mt-2 space-y-2 rounded-md border border-rc-border p-3"
        >
          <textarea
            name="correctiveAction"
            placeholder="What was done about it? (the remedy, and anything put in place to stop it recurring)"
            required
            rows={2}
            className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" name="correctiveActionDate" className="rounded-md border border-rc-border px-2 py-1 text-sm" />
            <button
              type="submit"
              disabled={actionPending}
              className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
          </div>
          {actionState.error && <p className="text-xs text-rc-amber-deep">{actionState.error}</p>}
        </form>
      )}

      {notificationDue && (
        <form action={notifyForm} className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
          <span className="text-xs text-rc-muted">Notified NSW Fair Trading on</span>
          <input type="date" name="notifiedDate" className="rounded-md border border-rc-border px-2 py-1 text-sm" />
          <button
            type="submit"
            disabled={notifyPending}
            className="text-xs font-medium text-rc-green-deep hover:underline disabled:opacity-60"
          >
            Record
          </button>
          {notifyState.error && <span className="text-xs text-rc-amber-deep">{notifyState.error}</span>}
        </form>
      )}
    </div>
  );
}

function Tile({ n, l, ok, warn, bad }: { n: number | string; l: string; ok?: boolean; warn?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
