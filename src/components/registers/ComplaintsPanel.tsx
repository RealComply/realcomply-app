"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addComplaint, updateComplaintStatus, deleteComplaint, type ActionState } from "@/lib/actions/registers";
import type { Complaint, Profile, Property } from "@/lib/types";

const initialState: ActionState = { error: null };

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  under_review: "bg-red-100 text-red-700",
  resolved: "bg-rc-green/10 text-rc-green-deep",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  under_review: "Under review",
  resolved: "Resolved",
};

function daysSince(dateStr: string): number {
  const then = new Date(`${dateStr}T00:00:00Z`);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / (1000 * 60 * 60 * 24)));
}

export function ComplaintsPanel({
  complaints,
  staff,
  properties,
  viewerProfile,
  resolutionTargetDays,
}: {
  complaints: Complaint[];
  staff: Profile[];
  properties: Property[];
  viewerProfile: Profile;
  resolutionTargetDays: number;
}) {
  const [adding, setAdding] = useState(false);
  const [state, formAction, pending] = useActionState(addComplaint, initialState);

  const open = complaints.filter((c) => c.status !== "resolved");
  const resolvedThisYear = complaints.filter((c) => c.status === "resolved");
  const overdue = open.filter((c) => daysSince(c.received_date) > resolutionTargetDays);
  const oldestOpenDays = open.length > 0 ? Math.max(...open.map((c) => daysSince(c.received_date))) : 0;

  const nameFor = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "—" : "—");
  const addressFor = (id: string | null) => (id ? properties.find((p) => p.id === id)?.address ?? null : null);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile n={open.length} l="Open" bad={open.length > 0} />
        <Tile n={resolvedThisYear.length} l="Resolved" ok />
        <Tile n={overdue.length} l="Overdue" bad={overdue.length > 0} ok={overdue.length === 0} />
        <Tile n={`${oldestOpenDays}d`} l="Oldest open" />
        <Tile n={`${resolutionTargetDays}d`} l="Resolution target" />
      </div>

      <div className="mt-4 rounded-card border border-rc-border bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-rc-ink">Complaints register</h3>
            <p className="mt-0.5 text-xs text-rc-muted">
              Every complaint logged and tracked to resolution. A complaint touching a property is cross-linked to that file.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-xs font-medium text-rc-green-deep hover:underline"
          >
            {adding ? "Cancel" : "+ Log a complaint"}
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
              <input type="date" name="receivedDate" required className="rounded-md border border-rc-border px-2 py-1 text-sm" />
              <input
                type="text"
                name="complainant"
                placeholder="Complainant (e.g. 'K. Adams, buyer')"
                required
                className="w-56 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            <textarea
              name="nature"
              placeholder="What's the complaint about?"
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
            <textarea name="notes" placeholder="Notes (optional)" rows={1} className="w-full rounded-md border border-rc-border px-2 py-1 text-sm" />
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

        <div className="mt-3 overflow-x-auto">
          {complaints.length === 0 ? (
            <p className="text-sm text-rc-muted">No complaints logged.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rc-border text-left text-xs uppercase tracking-wide text-rc-faint">
                  <th className="pb-2 pr-3">Received</th>
                  <th className="pb-2 pr-3">Complainant</th>
                  <th className="pb-2 pr-3">Matter</th>
                  <th className="pb-2 pr-3">Agent</th>
                  <th className="pb-2 pr-3">Nature</th>
                  <th className="pb-2 pr-3">Days</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-100 align-top">
                    <td className="py-2 pr-3">{c.received_date}</td>
                    <td className="py-2 pr-3">{c.complainant}</td>
                    <td className="py-2 pr-3">
                      {addressFor(c.property_id) ? (
                        <Link href={`/dashboard/${c.property_id}`} className="text-rc-green-deep hover:underline">
                          {addressFor(c.property_id)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{nameFor(c.agent_id)}</td>
                    <td className="py-2 pr-3 max-w-xs">{c.nature}</td>
                    <td className="py-2 pr-3">{daysSince(c.received_date)}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        {c.status !== "resolved" && (
                          <>
                            {c.status === "open" && (
                              <form action={updateComplaintStatus.bind(null, c.id, "under_review")}>
                                <button type="submit" className="text-xs text-rc-green-deep hover:underline">
                                  Review
                                </button>
                              </form>
                            )}
                            <form action={updateComplaintStatus.bind(null, c.id, "resolved")}>
                              <button type="submit" className="text-xs text-rc-green-deep hover:underline">
                                Resolve
                              </button>
                            </form>
                          </>
                        )}
                        {viewerProfile.is_licensee_in_charge && (
                          <form action={deleteComplaint.bind(null, c.id)}>
                            <button type="submit" className="text-xs text-rc-faint hover:text-rc-amber-deep">
                              Remove
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ n, l, ok, bad }: { n: number | string; l: string; ok?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
