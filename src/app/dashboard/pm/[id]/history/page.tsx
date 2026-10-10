import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import {
  loadPmProperty,
  loadPmRecords,
  pmAgencySettings,
  pmPeople,
  pmTenancyInput,
  pmTenancyTicks,
  type PmItemStateRow,
  type PmRecordRow,
  type PmTenancyRow,
} from "@/lib/data/pm";
import { formatAuDate, formatAuDateTimeShort } from "@/lib/format-date";
import {
  PM_COPY,
  PM_EVENT_RECORDS,
  pmGround,
  pmItem,
  pmItemStage,
  pmPetGroundLabel,
  pmPetOutcomeLabel,
  pmRetentionUntil,
  pmStage,
  pmWaterResult,
  type PmStageNumber,
  type PmWaterAnswers,
} from "@/lib/rules/nsw-pm";
import { pmStageItems, pmTenancyFiled, type PmTicks } from "@/lib/rules/pm-engine";

// History for one PM property (brief B8): the original onboarding record and
// every past tenancy, read-only, with who ticked what and when, and every
// change ever made (the append-only history from 0052).

type EventRow = {
  tenancy_id: string | null;
  item_key: string;
  state: "done" | "na" | "open";
  detail: Record<string, unknown> | null;
  changed_by: string;
  changed_at: string;
};

const STATE_WORD = { done: "Ticked", na: "Marked N/A", open: "Unticked" } as const;

const RECORD_TITLE: Record<string, string> = {
  ...Object.fromEntries(PM_EVENT_RECORDS.map((r) => [r.key, r.title])),
  pet_request: "Pet request",
  pet_application: "Pet on the application",
};

export default async function PmHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const settings = await pmAgencySettings(supabase, profile.agency_id);
  if (!settings.enabled) notFound();

  const [loaded, people, records, { data: eventRows }] = await Promise.all([
    loadPmProperty(supabase, id),
    pmPeople(supabase),
    loadPmRecords(supabase, id),
    supabase
      .from("pm_item_events")
      .select("tenancy_id, item_key, state, detail, changed_by, changed_at")
      .eq("property_id", id)
      .order("changed_at", { ascending: true }),
  ]);
  if (!loaded) notFound();

  const { property, tenancy: current, tenancies, states } = loaded;
  const events = (eventRows ?? []) as EventRow[];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const name = (uid: string | null | undefined) => (uid ? (nameOf.get(uid) ?? "Someone") : "Someone");

  const onboardingStates = states.filter((s) => s.tenancy_id === null);
  const showOnboarding = property.origin === "new";
  const past = tenancies.filter((t) => current && t.seq < current.seq).sort((a, b) => b.seq - a.seq);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <Link href={`/dashboard/pm/${property.id}`} className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
        ← Back to the property
      </Link>
      <h1 className="mt-3 text-xl font-bold tracking-tight text-rc-ink sm:text-2xl">History</h1>
      <p className="mt-1 text-sm text-rc-muted">{property.address}. Read-only.</p>

      {showOnboarding && (
        <HistoryCard title="Original onboarding record" sub={`Added ${formatAuDateTimeShort(property.created_at)} by ${name(property.created_by)}`}>
          <ItemList stage={1} ticks={ticksFrom(onboardingStates)} tenancy={null} name={name} states={onboardingStates} />
          <Changes events={events.filter((e) => e.tenancy_id === null)} name={name} />
        </HistoryCard>
      )}

      {past.length === 0 && (
        <p className="mt-6 rounded-card border border-dashed border-rc-border bg-white px-6 py-10 text-center text-sm text-rc-muted">
          No past tenancies yet. A tenancy is kept here once the property is let again.
        </p>
      )}

      {past.map((t) => (
        <TenancyCard
          key={t.id}
          t={t}
          states={states}
          events={events.filter((e) => e.tenancy_id === t.id)}
          records={records.filter((r) => r.tenancy_id === t.id)}
          name={name}
        />
      ))}
    </main>
  );
}

function ticksFrom(rows: PmItemStateRow[]): PmTicks {
  const out: PmTicks = {};
  for (const r of rows) out[r.item_key] = { state: r.state, changedBy: r.changed_by, changedAt: r.changed_at };
  return out;
}

function HistoryCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 overflow-hidden rounded-card border border-rc-border bg-white shadow-card">
      <div className="border-l-[3px] border-rc-green-deep bg-rc-green-soft px-4 py-3">
        <h2 className="text-sm font-bold text-rc-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[12.5px] text-rc-muted">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function TenancyCard({
  t,
  states,
  events,
  records,
  name,
}: {
  t: PmTenancyRow;
  states: PmItemStateRow[];
  events: EventRow[];
  records: PmRecordRow[];
  name: (uid: string | null | undefined) => string;
}) {
  const input = pmTenancyInput(t);
  const ticks = pmTenancyTicks(t.id, states);
  const filed = pmTenancyFiled(input, ticks);
  const facts: string[] = [];
  if (t.move_in_date) facts.push(`Moved in ${formatAuDate(t.move_in_date)}`);
  if (t.vacate_date) facts.push(`Vacate date ${formatAuDate(t.vacate_date)}`);
  if (t.move_out_date) facts.push(`Moved out ${formatAuDate(t.move_out_date)}`);
  if (input.endedBy === "tenant") facts.push("Ended by the tenant");
  if (input.endedBy === "landlord") facts.push(`Ended by the landlord${input.ground ? `: ${pmGround(input.ground).label}` : ""}`);

  return (
    <HistoryCard title={`Tenancy ${t.seq}${filed ? "" : " (still finishing)"}`} sub={facts.length ? `${facts.join(". ")}.` : undefined}>
      {t.move_out_date && (
        <p className="border-b border-rc-border px-4 py-2.5 text-[13px] text-rc-ink">
          {PM_COPY.retentionTenant(formatAuDate(pmRetentionUntil(t.move_out_date)))}
        </p>
      )}
      {([2, 3, 5] as PmStageNumber[]).map((n) =>
        t.before_stages.includes(n) ? (
          <p key={n} className="border-b border-rc-border px-4 py-2.5 text-[13px] text-rc-muted">
            <b className="font-semibold text-rc-ink">{pmStage(n).title}:</b> {PM_COPY.beforeRealComply}.{" "}
            {PM_COPY.beforeRealComplyBody}
          </p>
        ) : (
          <div key={n}>
            <p className="px-4 pb-1 pt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-rc-muted">{pmStage(n).title}</p>
            <ItemList stage={n} ticks={ticks} tenancy={t} name={name} states={states} />
          </div>
        ),
      )}
      {records.length > 0 && (
        <div>
          <p className="px-4 pb-1 pt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-rc-muted">Recorded</p>
          <ul>
            {records.map((r) => (
              <li key={r.id} className="border-t border-rc-border px-4 py-2 text-[13px] text-rc-ink">
                <b className="font-semibold">{RECORD_TITLE[r.kind] ?? r.kind}</b>
                {r.data?.received ? `. Received ${formatAuDate(r.data.received)}` : ""}
                {r.data?.outcome ? `. ${pmPetOutcomeLabel(r.data.outcome)}` : ""}
                {r.data?.ground ? `: ${pmPetGroundLabel(r.data.ground)}` : ""}
                <span className="block text-[12.5px] text-rc-muted">
                  {name(r.recorded_by)} · {formatAuDateTimeShort(r.recorded_at)}
                  {r.response_given_at
                    ? `. Response given: ${name(r.response_given_by)} · ${formatAuDateTimeShort(r.response_given_at)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Changes events={events} name={name} />
    </HistoryCard>
  );
}

function ItemList({
  stage,
  ticks,
  tenancy,
  name,
  states,
}: {
  stage: PmStageNumber;
  ticks: PmTicks;
  tenancy: PmTenancyRow | null;
  name: (uid: string | null | undefined) => string;
  states: PmItemStateRow[];
}) {
  const items = tenancy ? pmStageItems(pmStage(stage), pmTenancyInput(tenancy)) : pmStage(stage).items.map((i) => ({ ...i, auto: null }));
  return (
    <ul>
      {items.map((item) => {
        const t = ticks[item.key];
        let line: string;
        if (item.auto) line = `N/A · ${item.auto.note}`;
        else if (item.kind === "water") {
          const row = states.find((s) => s.tenancy_id === tenancy?.id && s.item_key === item.key);
          const result = row ? pmWaterResult((row.detail ?? {}) as PmWaterAnswers) : null;
          line = row && result?.line ? `${result.line} ${name(row.changed_by)} · ${formatAuDateTimeShort(row.changed_at)}` : "Not answered";
        } else if (!t || t.state === "open") line = "Not ticked";
        else line = `${t.state === "done" ? "✓" : "N/A ·"} ${name(t.changedBy)} · ${formatAuDateTimeShort(t.changedAt)}`;
        const settled = item.auto || (t && t.state !== "open");
        return (
          <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t border-rc-border px-4 py-2">
            <span className="text-[13px] font-semibold text-rc-ink">{item.title}</span>
            <span className={`text-[12.5px] ${settled ? "font-semibold text-rc-green-deep" : "text-rc-muted"}`}>{line}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Changes({ events, name }: { events: EventRow[]; name: (uid: string | null | undefined) => string }) {
  if (events.length === 0) return null;
  return (
    <details className="border-t border-rc-border px-4 py-2.5">
      <summary className="cursor-pointer text-[13px] font-semibold text-rc-green-deep">Every change ({events.length})</summary>
      <ol className="mt-2 space-y-1">
        {events.map((e, i) => {
          const item = pmItem(e.item_key);
          const stage = pmItemStage(e.item_key);
          const what =
            item?.kind === "water"
              ? `Answered: ${pmWaterResult((e.detail ?? {}) as PmWaterAnswers).line ?? "in progress"}`
              : STATE_WORD[e.state];
          return (
            <li key={i} className="text-[12.5px] text-rc-muted">
              {formatAuDateTimeShort(e.changed_at)} · {name(e.changed_by)} · {what}: {item?.title ?? e.item_key}
              {stage ? ` (${stage.title})` : ""}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
