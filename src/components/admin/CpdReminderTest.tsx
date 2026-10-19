"use client";

import { useActionState } from "react";
import {
  runCpdRemindersForMadeUpOffice,
  sendTestCpdReminder,
  type CpdAdminState,
} from "@/lib/actions/cpd-reminders-admin";

// CPD reminders on the staff page (brief, 19 Oct 2026): a test email of
// either version to a test address, and the real job run for a made-up
// office as if it were a send date. Both only ever reach getadamc3+ addresses.

const input =
  "min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";
const select = "rounded-lg border border-rc-border bg-white px-3 py-2 text-sm text-rc-ink";
const button =
  "inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";

function Outcome({ state }: { state: CpdAdminState }) {
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

export function CpdReminderTest({ offices, dates }: { offices: { id: string; name: string }[]; dates: string[] }) {
  const [testState, sendTest, sendingTest] = useActionState(sendTestCpdReminder, { error: null } as CpdAdminState);
  const [runState, run, running] = useActionState(runCpdRemindersForMadeUpOffice, { error: null } as CpdAdminState);

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Test the CPD reminders</p>
      <p className="mt-1 text-xs text-rc-muted">
        The reminder a person gets, or the licensee&rsquo;s summary, marked [Test] with example names. It only goes
        to your test addresses (getadamc3+…@gmail.com), and nothing is recorded.
      </p>
      <form action={sendTest} className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="cpd-test-email">
          Test address
        </label>
        <input
          id="cpd-test-email"
          name="email"
          type="email"
          required
          defaultValue="getadamc3+test1@gmail.com"
          className={input}
        />
        <label className="sr-only" htmlFor="cpd-test-version">
          Which email
        </label>
        <select id="cpd-test-version" name="version" defaultValue="person" className={select}>
          <option value="person">The person&rsquo;s reminder</option>
          <option value="summary">The licensee&rsquo;s summary</option>
        </select>
        <button type="submit" disabled={sendingTest} className={button}>
          {sendingTest ? "Sending…" : "Email a test reminder"}
        </button>
      </form>
      <Outcome state={testState} />

      <p className="mt-4 text-xs text-rc-muted">
        Or run the real reminders for one made-up office, as if today were a send date. Only offices whose people
        are all on your test addresses are listed. Each send is recorded, so the same date never sends twice.
      </p>
      {offices.length === 0 ? (
        <p className="mt-2 text-xs text-rc-faint">No made-up office right now.</p>
      ) : (
        <form action={run} className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="cpd-run-office">
            Made-up office
          </label>
          <select id="cpd-run-office" name="agency" className={select}>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="cpd-run-date">
            Send date
          </label>
          <select id="cpd-run-date" name="date" defaultValue={dates[0]} className={select}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button type="submit" disabled={running} className={button}>
            {running ? "Running…" : "Run the reminders"}
          </button>
        </form>
      )}
      <Outcome state={runState} />
    </div>
  );
}
