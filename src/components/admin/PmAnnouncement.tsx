"use client";

import { useActionState } from "react";
import {
  sendPmAnnouncementTest,
  sendPmAnnouncementToOffices,
  type PmAnnouncementState,
} from "@/lib/actions/pm-announcement-admin";

// The property management announcement (Adam, 22 Oct 2026): the five
// offices it goes to as they stand right now, a test to Adam's test address,
// and the send. Each office once; the list shows what's recorded.

export type PmAnnouncementListRow = {
  office: string;
  licenseeName: string | null;
  email: string | null;
  problem: string | null;
  /** "Sent 22 Oct, 9:14 am", "Tried, failed", or null when not sent. */
  recorded: string | null;
};

const button =
  "inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";
const quiet =
  "inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-4 py-2 text-xs font-semibold text-rc-ink transition hover:bg-rc-bg-alt disabled:opacity-60";

function Outcome({ state }: { state: PmAnnouncementState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="mt-2 whitespace-pre-line text-xs font-medium text-rc-green-deep">
          {state.notice}
        </p>
      )}
    </>
  );
}

export function PmAnnouncement({ rows, testAddress }: { rows: PmAnnouncementListRow[]; testAddress: string }) {
  const [testState, sendTest, sendingTest] = useActionState(sendPmAnnouncementTest, { error: null } as PmAnnouncementState);
  const [sendState, send, sending] = useActionState(sendPmAnnouncementToOffices, { error: null } as PmAnnouncementState);
  const toGo = rows.filter((r) => !r.recorded && !r.problem).length;

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">
        Property management announcement (one-off)
      </p>
      <p className="mt-1 text-xs text-rc-muted">
        &ldquo;Property management is now in your RealComply account&rdquo;, to the current licensee in charge of
        these five offices and nobody else. Replies go to admin@realcomply.com.au. Each office gets it once: every
        send is recorded, so pressing Send again sends nothing.
      </p>

      <ul className="mt-3 divide-y divide-rc-border rounded-lg border border-rc-border">
        {rows.map((r) => (
          <li key={r.office} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 text-xs">
            <span className="min-w-0">
              <span className="font-semibold text-rc-ink">{r.office}</span>
              <span className="block text-rc-muted">
                {r.licenseeName ?? "No name"}
                {r.email ? <> &middot; {r.email}</> : null}
              </span>
            </span>
            <span
              className={
                r.recorded
                  ? "font-medium text-rc-green-deep"
                  : r.problem
                    ? "font-medium text-rc-amber-deep"
                    : "text-rc-faint"
              }
            >
              {r.recorded ?? r.problem ?? "Not sent yet"}
            </span>
          </li>
        ))}
      </ul>

      <form action={sendTest} className="mt-3">
        <p className="text-xs text-rc-muted">
          First, the test: the email exactly as the first office&rsquo;s licensee gets it, to {testAddress} only.
          Nothing is recorded.
        </p>
        <button type="submit" disabled={sendingTest} className={`${quiet} mt-2`}>
          {sendingTest ? "Sending…" : "Send the test"}
        </button>
      </form>
      <Outcome state={testState} />

      <form action={send} className="mt-4">
        <label className="flex items-start gap-2 text-xs text-rc-ink">
          <input type="checkbox" name="confirm" value="yes" required className="mt-0.5" />
          <span>I&rsquo;ve checked the list above. Send to the {toGo === 1 ? "one office" : `${toGo} offices`} not sent yet.</span>
        </label>
        <button type="submit" disabled={sending} className={`${button} mt-2`}>
          {sending ? "Sending…" : "Send to the offices"}
        </button>
      </form>
      <Outcome state={sendState} />
    </div>
  );
}
