"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { addComplaint, updateComplaintStatus, deleteComplaint, type ActionState } from "@/lib/actions/registers";
import { useOnSaved } from "@/lib/use-on-saved";
import { formatAuDate } from "@/lib/format-date";
import { Paperclip } from "lucide-react";
import { complaintFilesFor, filesToggleLabel } from "@/lib/complaint-files";
import { ComplaintFiles } from "@/components/registers/ComplaintFiles";
import { ComplaintSignOff } from "@/components/registers/ComplaintSignOff";
import { complaintAwaitsSignOff, complaintRecordLines } from "@/lib/reviews/records";
import type { Complaint, ComplaintFile, Profile, Property } from "@/lib/types";

const initialState: ActionState = { error: null };

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  under_review: "bg-red-100 text-red-700",
  resolved: "bg-rc-green/10 text-rc-green-deep",
};
const ACTION =
  "rounded-full border border-rc-border px-3 py-1 text-xs font-medium text-rc-green-deep transition hover:bg-rc-green-soft/40";

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
  canChange = false,
  canMoveOn = canChange,
  canSignOff = canChange,
  packMonthOf = {},
  nameOf = {},
  resolutionTargetDays,
  files = [],
  filesReady = false,
  fileUrlByPath = {},
}: {
  complaints: Complaint[];
  staff: Profile[];
  properties: Property[];
  viewerProfile: Profile;
  /**
   * Review, Resolve, removing a file and deleting a complaint: the licensee in
   * charge only. An office manager reads the register and adds to it, nothing
   * more (Adam, 31 Oct 2026: "adding and read only"; 0102).
   */
  canChange?: boolean;
  /**
   * Under review and Resolved: the licensee in charge or the office manager
   * (REVERSAL, Adam, 3 Nov 2026; 0108). Was: the licensee only.
   */
  canMoveOn?: boolean;
  /** The sign-off of a resolved complaint: the licensee in charge only (0108). */
  canSignOff?: boolean;
  /** Which month's pack a sign-off was given in (0109). */
  packMonthOf?: Record<string, string>;
  /** Everyone's display name, people who have left included (the picker isn't). */
  nameOf?: Record<string, string>;
  resolutionTargetDays: number;
  /**
   * Files on the office's complaints (0101), removed ones included. The
   * REVERSAL of 16 Oct 2026 is in lib/complaint-files.ts.
   */
  files?: ComplaintFile[];
  /** False until 0101 has run: no Files column, and nothing to add one with. */
  filesReady?: boolean;
  /** Links to open each file, made on the server with the viewer's own access. */
  fileUrlByPath?: Record<string, string>;
}) {
  const [adding, setAdding] = useState(false);
  // Which complaints have their files open.
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const toggleFiles = (id: string) =>
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [state, formAction, pending] = useActionState(addComplaint, initialState);
  useOnSaved(pending, state.error, () => setAdding(false));

  const open = complaints.filter((c) => c.status !== "resolved");
  const resolvedThisYear = complaints.filter((c) => c.status === "resolved");
  const overdue = open.filter((c) => daysSince(c.received_date) > resolutionTargetDays);
  const oldestOpenDays = open.length > 0 ? Math.max(...open.map((c) => daysSince(c.received_date))) : 0;

  const nameFor = (id: string | null) =>
    id ? nameOf[id] ?? staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "—" : "—";
  const addressFor = (id: string | null) => (id ? properties.find((p) => p.id === id)?.address ?? null : null);
  // An office manager sees only the listings they can open (every listing in
  // the office is still the licensee's, 0093). A complaint linked to another
  // listing says so, without its address.
  const linkedElsewhere = (id: string | null) => Boolean(id) && !addressFor(id);

  function card(c: Complaint) {
    const { current, removed } = complaintFilesFor(c.id, files);
    const filesOpen = openFiles.has(c.id);
    const awaitsSignOff = canSignOff && complaintAwaitsSignOff(c);
    const days = daysSince(c.received_date);
    const late = c.status !== "resolved" && days > resolutionTargetDays;
    const address = addressFor(c.property_id);
    const agent = c.agent_id ? nameFor(c.agent_id) : null;
    const lines = complaintRecordLines(c, packMonthOf[c.id] ?? null);
    return (
      <article key={c.id} data-complaint={c.id} className="rounded-xl border border-rc-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h5 className="min-w-0 break-words text-sm font-semibold text-rc-ink">{c.complainant}</h5>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>
            {STATUS_LABELS[c.status]}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-rc-muted">
          Received {formatAuDate(c.received_date)}
          {c.status !== "resolved" && (
            <>
              {" · "}
              <span className={late ? "font-semibold text-red-700" : undefined}>
                {days} {days === 1 ? "day" : "days"} open{late ? `, past the ${resolutionTargetDays}-day target` : ""}
              </span>
            </>
          )}
        </p>
        {(agent || c.property_id) && (
          <p className="mt-0.5 text-xs text-rc-muted">
            {agent && <>Agent: {agent}</>}
            {agent && c.property_id && " · "}
            {address ? (
              <>
                Listing:{" "}
                <Link href={`/dashboard/${c.property_id}`} className="text-rc-green-deep hover:underline">
                  {address}
                </Link>
              </>
            ) : linkedElsewhere(c.property_id) ? (
              <>Listing: A listing you can&apos;t open</>
            ) : null}
          </p>
        )}
        <p className="mt-2.5 whitespace-pre-line break-words text-sm leading-relaxed text-rc-ink">{c.nature}</p>
        {c.notes && (
          <p className="mt-1.5 whitespace-pre-line break-words text-xs text-rc-muted">
            <span className="font-medium">Notes:</span> {c.notes}
          </p>
        )}
        {lines.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px] text-rc-muted">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-neutral-100 pt-3">
          {filesReady ? (
            <button
              type="button"
              onClick={() => toggleFiles(c.id)}
              aria-expanded={filesOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-rc-green-deep hover:underline"
            >
              <Paperclip size={12} className="shrink-0" aria-hidden />
              {filesToggleLabel(current.length, filesOpen)}
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {canMoveOn && c.status !== "resolved" && (
              <>
                {c.status === "open" && (
                  <form action={updateComplaintStatus.bind(null, c.id, "under_review")}>
                    <button type="submit" className={ACTION}>
                      Review
                    </button>
                  </form>
                )}
                <form action={updateComplaintStatus.bind(null, c.id, "resolved")}>
                  <button type="submit" className={ACTION}>
                    Resolve
                  </button>
                </form>
              </>
            )}
            {/* A complaint with files on it keeps them until each is
                removed, and each removal is recorded (0101): the
                database refuses deleting it before then. */}
            {canChange &&
              (current.length > 0 ? (
                <span
                  title="Remove its files first. Each removal is recorded."
                  className="cursor-default px-1 text-xs text-neutral-300"
                >
                  Remove
                </span>
              ) : (
                <form action={deleteComplaint.bind(null, c.id)}>
                  <button type="submit" className="px-1 text-xs text-rc-faint hover:text-rc-amber-deep">
                    Remove
                  </button>
                </form>
              ))}
          </div>
        </div>
        {filesReady && filesOpen && (
          <div className="mt-3 rounded-lg bg-rc-bg-alt p-3">
            <ComplaintFiles
              agencyId={viewerProfile.agency_id}
              complaintId={c.id}
              current={current}
              removed={removed}
              urlByPath={fileUrlByPath}
              nameOf={nameOf}
              canRemove={canChange}
            />
          </div>
        )}
        {awaitsSignOff && (
          <div className="mt-3 rounded-lg border border-rc-green-deep/20 bg-rc-green-soft/40 p-3">
            <ComplaintSignOff complaintId={c.id} />
          </div>
        )}
      </article>
    );
  }

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
            {!canChange && (
              <p className="mt-1 text-xs text-rc-muted">
                {canMoveOn
                  ? "You can log complaints, add files, and mark them Under review or Resolved. Signing off and removing are for the licensee in charge."
                  : "You can log complaints and add files. Review, Resolve and removing are for the licensee in charge."}
              </p>
            )}
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
          <form action={formAction} className="mt-3 space-y-2 rounded-md border border-rc-border p-3">
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

        {/* One card per complaint, open ones first (Adam, 10 Nov 2026: "the
            columns don't work. the layout needs to be much easier to read").
            Was an 8-column table that scrolled sideways, with Add a file off
            the right edge below about 1,250px wide. Nothing scrolls sideways
            now, at any width. */}
        {complaints.length === 0 ? (
          <p className="mt-4 text-sm text-rc-muted">No complaints logged.</p>
        ) : (
          <div className="mt-4 space-y-6">
            {[
              { title: "Open", list: open },
              { title: "Resolved", list: resolvedThisYear },
            ]
              .filter((g) => g.list.length > 0)
              .map((g) => (
                <section key={g.title}>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
                    {g.title} ({g.list.length})
                  </h4>
                  <div className="mt-2 space-y-3">{g.list.map((c) => card(c))}</div>
                </section>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ n, l, ok, bad }: { n: number | string; l: string; ok?: boolean; bad?: boolean }) {
  const color = bad ? "text-red-700" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-card border border-rc-border bg-white px-3.5 py-2.5 shadow-card">
      <div className={`text-lg font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
