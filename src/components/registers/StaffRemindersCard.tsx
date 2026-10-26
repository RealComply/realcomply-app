"use client";

import { useActionState } from "react";
import { Mail } from "lucide-react";
import { sendStaffReminders, type ReminderSendState } from "@/lib/actions/staff-reminders";
import { remindableNow, type ReminderKind } from "@/lib/staff-reminders/outstanding";
import { formatAuTimestamp } from "@/lib/format-date";

// Who still needs to sign the SG Manual, or read and tick the annexure and
// the Supervision Guidelines, and a button to email them (Adam, 26 Oct
// 2026; 0093). For the licensee and an office manager, on the SG Manual page.

const initial: ReminderSendState = { error: null, sent: 0, skipped: 0, failed: 0 };

const WHAT: Record<ReminderKind, string> = {
  sg_manual_sign: "Sign the SG Manual",
  sg_read: "Read and tick the annexure and Supervision Guidelines",
};

export type ReminderRow = { id: string; name: string; kinds: ReminderKind[]; lastRemindedAt: string | null };

export function StaffRemindersCard({ rows }: { rows: ReminderRow[] }) {
  const [state, action, pending] = useActionState(sendStaffReminders, initial);
  const now = new Date();
  const due = rows.filter((r) => remindableNow(r.lastRemindedAt, now)).length;

  return (
    <section aria-label="Staff still to sign or read" className="mt-6 rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-5">
      <h2 className="text-sm font-bold text-rc-ink">Still to sign or read ({rows.length})</h2>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Email each of them a reminder, with a link to what they still need to do. One reminder a day at most.
      </p>
      <ul className="mt-3 divide-y divide-rc-border text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="font-medium text-rc-ink">{r.name}</span>
            <span className="text-xs text-rc-muted">
              {r.kinds.map((k) => WHAT[k]).join("; ")}
              {r.lastRemindedAt ? ` · Reminded ${formatAuTimestamp(r.lastRemindedAt)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || due === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
        >
          <Mail size={15} aria-hidden="true" />
          {pending ? "Sending…" : due === 0 ? "All reminded today" : `Email ${due} reminder${due === 1 ? "" : "s"}`}
        </button>
        {state.sent > 0 && !state.error && (
          <span role="status" className="text-sm text-rc-green-deep">
            Sent {state.sent} reminder{state.sent === 1 ? "" : "s"}.
          </span>
        )}
        {state.error && (
          <span role="alert" className="text-sm text-rc-amber-deep">
            {state.error}
          </span>
        )}
      </form>
    </section>
  );
}
