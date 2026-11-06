import Link from "next/link";
import { wholeDollars, type LadderRow, type PayRow } from "@/lib/billing/plan-change";

// The pieces of Change plan (mockup signed off by Adam, 6 Nov 2026), with no
// data loading of their own, so the pages and their screenshots render the
// same thing.

export function PlanLadder({ agent, office, per }: { agent: LadderRow[]; office: LadderRow[]; per: "month" | "year" }) {
  return (
    <section className="space-y-2 rounded-2xl border border-rc-border bg-white p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Agent plans: one agent</h2>
      {agent.map((row) => (
        <PlanRow key={row.plan} row={row} per={per} />
      ))}
      <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-rc-faint">
        Office plans: a team, with registers, trust and the licensee in charge
      </h2>
      {office.map((row) => (
        <PlanRow key={row.plan} row={row} per={per} />
      ))}
    </section>
  );
}

function PlanRow({ row, per }: { row: LadderRow; per: "month" | "year" }) {
  const disabled = !row.available;
  return (
    <label
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl border px-4 py-3 ${
        row.current
          ? "border-rc-ink"
          : disabled
            ? "border-rc-border opacity-55"
            : "cursor-pointer border-rc-border hover:border-rc-green-deep has-[:checked]:border-rc-green-deep has-[:checked]:bg-rc-green-soft"
      }`}
    >
      <input
        type="radio"
        name="plan"
        value={row.plan}
        required
        disabled={disabled}
        className="accent-rc-green-deep"
        aria-describedby={`why-${row.plan}`}
      />
      <span className="text-sm font-bold text-rc-ink">
        {row.name}
        {row.current && (
          <span className="ml-2 rounded-full border border-rc-border bg-rc-bg-alt px-2 py-0.5 text-xs font-bold text-rc-ink">
            Your plan
          </span>
        )}
      </span>
      <span className="whitespace-nowrap text-sm font-bold tabular-nums text-rc-ink">
        {wholeDollars(row.price)}
        <span className="font-semibold text-rc-muted"> a {per}</span>
      </span>
      <span id={`why-${row.plan}`} className="col-span-2 col-start-2 text-xs text-rc-muted">
        {row.reason ?? row.band}
      </span>
    </label>
  );
}

export function PaySummary({ rows, note }: { rows: PayRow[]; note: string }) {
  return (
    <section className="rounded-2xl border border-rc-border bg-white p-6">
      <h2 className="text-base font-bold text-rc-ink">What you&rsquo;ll pay</h2>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-y-2 text-sm tabular-nums">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className={`text-rc-ink ${row.total ? "border-t border-rc-border pt-2 font-bold" : ""}`}>
              {row.label}
            </dt>
            <dd
              className={`pl-4 text-right text-rc-ink ${row.total ? "border-t border-rc-border pt-2 font-bold" : "font-semibold"}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-rc-muted">{note}</p>
    </section>
  );
}

/** "You're on Office 1." with next steps (mockup step 4). */
export function PlanChangeDone({ title, body, nextSteps }: { title: string; body: string; nextSteps: boolean }) {
  return (
    <section className="mt-5 rounded-2xl border border-rc-green-deep/25 bg-rc-green-soft px-5 py-4 text-sm text-rc-ink">
      <p>
        <span className="font-bold">{title}</span> {body}
      </p>
      {nextSteps && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Next steps</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <Link
              href="/dashboard/team"
              className="inline-flex min-h-11 items-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
            >
              Invite your team
            </Link>
            <Link
              href="/dashboard/home"
              className="inline-flex min-h-11 items-center rounded-full border border-rc-border bg-white px-5 py-2.5 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep"
            >
              Set up your office
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
