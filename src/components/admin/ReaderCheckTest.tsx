"use client";

import { startTransition, useActionState } from "react";
import { runReaderCheckTest, sendReaderWeekTest, type ReaderAdminState } from "@/lib/actions/reader-admin";
import { sendKeepingFields } from "@/components/compliance/send-keeping-fields";

// The reader's checks on the staff page (Adam, 1 Nov 2026): the daily reader
// check run now with the real reader, and Monday's staff email about the
// week's reads with made-up figures. Both only go to getadamc3+ addresses.

const input =
  "min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";
const button =
  "inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";

function Outcome({ state }: { state: ReaderAdminState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="mt-2 text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="mt-2 text-xs font-medium text-rc-green-deep">
          {state.notice}
        </p>
      )}
    </>
  );
}

export function ReaderCheckTest() {
  const [checkState, runCheck, checking] = useActionState(runReaderCheckTest, { error: null } as ReaderAdminState);
  const [weekState, sendWeek, sendingWeek] = useActionState(sendReaderWeekTest, { error: null } as ReaderAdminState);

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">The document reader</p>
      <p className="mt-1 text-xs text-rc-muted">
        Run the daily reader check now: the real reader reads the made-up 27-sale comparable-sales report, and the
        result is emailed to a test address. Takes up to a minute or two.
      </p>
      <form
        method="post"
        onSubmit={(e) => sendKeepingFields(e, runCheck, startTransition)}
        className="mt-2.5 flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor="reader-check-email">
          Test address
        </label>
        <input
          id="reader-check-email"
          name="email"
          type="email"
          required
          defaultValue="getadamc3+reader-check@gmail.com"
          className={input}
        />
        <button type="submit" disabled={checking} className={button}>
          {checking ? "Reading the sample…" : "Run the check and email it"}
        </button>
      </form>
      <Outcome state={checkState} />

      <p className="mt-4 text-xs text-rc-muted">
        Monday&rsquo;s staff email about the week&rsquo;s reads, with made-up figures, to a test address.
      </p>
      <form
        method="post"
        onSubmit={(e) => sendKeepingFields(e, sendWeek, startTransition)}
        className="mt-2.5 flex flex-wrap items-center gap-2"
      >
        <label className="sr-only" htmlFor="reader-week-email">
          Test address
        </label>
        <input
          id="reader-week-email"
          name="email"
          type="email"
          required
          defaultValue="getadamc3+reader-week@gmail.com"
          className={input}
        />
        <button type="submit" disabled={sendingWeek} className={button}>
          {sendingWeek ? "Sending…" : "Email a test weekly email"}
        </button>
      </form>
      <Outcome state={weekState} />
    </div>
  );
}
