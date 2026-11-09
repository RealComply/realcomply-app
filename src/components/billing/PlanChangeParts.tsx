import Link from "next/link";
import {
  OFFICE_ACCESS_LINES,
  intervalWord,
  perWord,
  wholeDollars,
  type LadderRow,
  type PayRow,
} from "@/lib/billing/plan-change";
import type { Plan } from "@/lib/billing/entitlement";
import type { Interval } from "@/lib/billing/stripe";

// The pieces of Change plan (mockup signed off by Adam, 6 Nov 2026), with no
// data loading of their own, so the pages and their screenshots render the
// same thing.

export type Ladder = "agent" | "office";

/**
 * Change plan, the layout Adam picked on 6 Nov 2026 (option 3 of three): one
 * ladder at a time, chosen with "Agent" or "Office", as upright cards. Each
 * card that can be picked submits straight to the confirm step.
 */
export function ChangePlanView(props: {
  currentPlan: Plan;
  /** The interval being shown (the Monthly or Yearly switch). */
  interval: Interval;
  ladder: Ladder;
  /** The shown ladder's plans. */
  rows: LadderRow[];
  listingCount: number;
  /** The plan on the shown ladder that the listings fit. */
  fits: Plan;
  /** "An office plan adds", for someone on an agent plan looking at office plans. */
  showOfficeAdds: boolean;
}) {
  const href = (ladder: Ladder, interval: Interval) =>
    `/dashboard/billing/change?ladder=${ladder}&interval=${interval}`;
  const per = perWord(props.interval);
  const tab = (ladder: Ladder, label: string) => (
    <Link
      href={href(ladder, props.interval)}
      aria-current={props.ladder === ladder ? "page" : undefined}
      className={`inline-flex min-h-11 items-center rounded-xl px-5 text-sm font-extrabold text-rc-ink transition ${
        props.ladder === ladder ? "bg-white shadow-sm" : "hover:bg-white/60"
      }`}
    >
      {label}
    </Link>
  );
  const segment = (interval: Interval, label: string) => (
    <Link
      href={href(props.ladder, interval)}
      aria-current={props.interval === interval ? "page" : undefined}
      className={`inline-flex min-h-11 items-center px-4 text-sm font-semibold transition ${
        props.interval === interval ? "bg-rc-green-deep text-white" : "text-rc-muted hover:text-rc-ink"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <form action="/dashboard/billing/change/confirm" method="get" className="mt-5 space-y-5">
      <input type="hidden" name="interval" value={props.interval} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Plans for" className="inline-flex gap-1 rounded-2xl bg-rc-bg-alt p-1">
          {tab("agent", "Agent")}
          {tab("office", "Office")}
        </nav>
        <nav
          aria-label="Billing period"
          className="inline-flex overflow-hidden rounded-full border border-rc-border bg-white"
        >
          {segment("monthly", "Monthly")}
          {segment("annual", "Yearly (2 months free)")}
        </nav>
      </div>

      {props.showOfficeAdds && (
        <div className="rounded-2xl bg-rc-green-soft px-5 py-4 text-sm text-rc-ink">
          <p className="font-extrabold">An office plan adds</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {OFFICE_ACCESS_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {props.rows.map((row) => (
          <PlanCard
            key={row.plan}
            row={row}
            per={per}
            fits={row.plan === props.fits}
            listingCount={props.listingCount}
            cta={row.plan === props.currentPlan ? `Switch to ${intervalWord(props.interval)}` : `Move to ${row.name}`}
          />
        ))}
      </div>
    </form>
  );
}

function PlanCard({
  row,
  per,
  fits,
  listingCount,
  cta,
}: {
  row: LadderRow;
  per: "month" | "year";
  fits: boolean;
  listingCount: number;
  cta: string;
}) {
  return (
    <div
      className={`flex min-h-[250px] flex-col gap-2.5 rounded-2xl p-4 ${
        row.current
          ? "border-2 border-rc-ink bg-white"
          : row.available
            ? "border border-rc-border bg-white"
            : "border border-rc-border bg-rc-bg-alt"
      }`}
    >
      <div className="flex min-h-6 flex-wrap gap-1.5">
        {row.current && (
          <span className="rounded-full bg-rc-ink px-2.5 py-0.5 text-xs font-bold text-white">Your plan</span>
        )}
        {fits && (
          <span className="rounded-full border border-rc-green-deep/25 bg-rc-green-soft px-2.5 py-0.5 text-xs font-bold text-rc-green-deep">
            Fits your {listingCount} {listingCount === 1 ? "listing" : "listings"}
          </span>
        )}
      </div>
      <h3 className={`text-lg font-extrabold ${row.available || row.current ? "text-rc-ink" : "text-rc-muted"}`}>
        {row.name}
      </h3>
      <p className="flex flex-wrap items-baseline gap-1.5">
        <span
          className={`text-3xl font-extrabold tracking-tight tabular-nums ${
            row.available || row.current ? "text-rc-ink" : "text-rc-muted"
          }`}
        >
          {wholeDollars(row.price)}
        </span>
        <span className="text-sm font-semibold text-rc-muted">a {per}</span>
      </p>
      <p className="text-sm text-rc-ink">{row.band}</p>
      <div className="mt-auto pt-3">
        {row.available ? (
          <button
            type="submit"
            name="plan"
            value={row.plan}
            className="inline-flex min-h-11 w-full items-center justify-center whitespace-nowrap rounded-full border-[1.5px] border-rc-green-deep bg-white px-3 text-sm font-bold text-rc-green-deep transition hover:bg-rc-green-deep hover:text-white"
          >
            {cta}
          </button>
        ) : (
          <p className={`text-sm ${row.current ? "font-semibold text-rc-ink" : "text-rc-muted"}`}>
            {row.current ? "The plan you\u2019re on" : row.reason}
          </p>
        )}
      </div>
    </div>
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
