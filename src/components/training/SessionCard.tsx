"use client";

import { useActionState, useState } from "react";
import { recordAttendance, deleteTrainingSession, type ActionState } from "@/lib/actions/registers";
import type { Profile, TrainingSession } from "@/lib/types";

const initialState: ActionState = { error: null };

export function SessionCard({
  session,
  staff,
  attendeeIds,
  canDelete,
  ownOnly = false,
}: {
  session: TrainingSession;
  staff: Profile[];
  attendeeIds: string[];
  canDelete: boolean;
  /** An agent or assistant: they read their own attendance only (0058), and
   *  only see sessions they attended, so a headcount would always say 1. */
  ownOnly?: boolean;
}) {
  const [editingAttendance, setEditingAttendance] = useState(false);
  // Closes once attendance has saved, and stays open with the message when it
  // hasn't (check, 10 Oct 2026; the ticks stayed open after a good save).
  const [state, formAction, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await recordAttendance(session.id, prev, fd);
    if (!result.error) setEditingAttendance(false);
    return result;
  }, initialState);
  // Someone archived (they've left) isn't offered for a session, but stays
  // ticked where already recorded, since an unticked name is removed on save
  // (check, 10 Oct 2026).
  const checklist = staff.filter((s) => !s.archived_at || attendeeIds.includes(s.id));

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-rc-ink">{session.title}</h3>
          <p className="mt-0.5 text-xs text-rc-muted">
            {session.session_date}
            {session.trainer_name && ` · ${session.trainer_name}${session.is_external ? " (external)" : ""}`}
            {session.is_cpd_eligible && ` · ${session.cpd_hours}h CPD-eligible`}
          </p>
          {session.notes && <p className="mt-1 text-xs text-rc-faint">{session.notes}</p>}
        </div>
        {canDelete && (
          <form action={deleteTrainingSession.bind(null, session.id)}>
            <button type="submit" className="text-xs text-rc-faint hover:text-rc-amber-deep">
              Delete
            </button>
          </form>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-rc-muted">
            {ownOnly
              ? "You attended"
              : attendeeIds.length === 0
                ? "No attendance recorded"
                : `${attendeeIds.length} attended`}
          </p>
          {/* Recording attendance rewrites people's session CPD, so it is the
              licensee's (Adam, 7 Oct 2026; was anyone). Same flag as delete. */}
          {canDelete && (
            <button
              type="button"
              onClick={() => setEditingAttendance((v) => !v)}
              className="text-xs font-medium text-rc-green-deep hover:underline"
            >
              {editingAttendance ? "Cancel" : "Edit attendance"}
            </button>
          )}
        </div>

        {!ownOnly && !editingAttendance && attendeeIds.length > 0 && (
          <p className="mt-1 text-xs text-rc-muted">
            {staff
              .filter((s) => attendeeIds.includes(s.id))
              .map((s) => s.full_name ?? s.email)
              .join(", ")}
          </p>
        )}

        {editingAttendance && (
          <form action={formAction} className="mt-2 space-y-2 rounded-md border border-rc-border p-2">
            <div className="flex flex-wrap gap-3">
              {checklist.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-xs text-rc-muted">
                  <input type="checkbox" name="attendee" value={s.id} defaultChecked={attendeeIds.includes(s.id)} />
                  {s.full_name ?? s.email}
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save attendance
            </button>
            {session.is_cpd_eligible && (
              <p className="text-xs text-rc-faint">
                Saving auto-logs {session.cpd_hours}h of CPD for each attendee checked.
              </p>
            )}
            {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
