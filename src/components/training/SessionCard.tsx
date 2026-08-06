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
}: {
  session: TrainingSession;
  staff: Profile[];
  attendeeIds: string[];
  canDelete: boolean;
}) {
  const [editingAttendance, setEditingAttendance] = useState(false);
  const boundAction = recordAttendance.bind(null, session.id);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  return (
    <div className="rounded-lg border border-rc-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-rc-ink">{session.title}</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            {session.session_date}
            {session.trainer_name && ` · ${session.trainer_name}${session.is_external ? " (external)" : ""}`}
            {session.is_cpd_eligible && ` · ${session.cpd_hours}h CPD-eligible`}
          </p>
          {session.notes && <p className="mt-1 text-xs text-neutral-400">{session.notes}</p>}
        </div>
        {canDelete && (
          <form action={deleteTrainingSession.bind(null, session.id)}>
            <button type="submit" className="text-xs text-neutral-400 hover:text-rc-amber-deep">
              Delete
            </button>
          </form>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-neutral-500">
            {attendeeIds.length === 0 ? "No attendance recorded" : `${attendeeIds.length} attended`}
          </p>
          <button
            type="button"
            onClick={() => setEditingAttendance((v) => !v)}
            className="text-xs font-medium text-rc-green-deep hover:underline"
          >
            {editingAttendance ? "Cancel" : "Edit attendance"}
          </button>
        </div>

        {!editingAttendance && attendeeIds.length > 0 && (
          <p className="mt-1 text-xs text-neutral-600">
            {staff
              .filter((s) => attendeeIds.includes(s.id))
              .map((s) => s.full_name ?? s.email)
              .join(", ")}
          </p>
        )}

        {editingAttendance && (
          <form action={formAction} className="mt-2 space-y-2 rounded-md border border-rc-border p-2">
            <div className="flex flex-wrap gap-3">
              {staff.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-xs text-neutral-600">
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
              <p className="text-xs text-neutral-400">
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
