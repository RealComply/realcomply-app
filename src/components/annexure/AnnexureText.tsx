import {
  SG_ANNEXURE_ADOPTION,
  SG_ANNEXURE_AGENT_STATEMENT,
  SG_ANNEXURE_NOTICE,
  SG_ANNEXURE_SCHEDULE_1_HEADING,
  SG_ANNEXURE_SCHEDULE_1_LINE,
  SG_ANNEXURE_SCHEDULE_2,
  SG_ANNEXURE_SCHEDULE_2_HEADING,
  SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES,
  SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES,
  SG_ANNEXURE_SUBTITLE,
  SG_ANNEXURE_TITLE,
  scheduleOne,
  type AnnexureSection,
} from "@/lib/legal/sg-annexure";

// The full annexure, as the signing page shows it in its scrolling panel. The
// same text the PDF prints (lib/legal/sg-annexure.ts), so what is read is what
// is signed.

function Section({ s }: { s: AnnexureSection }) {
  return (
    <section className="mt-6">
      <h3 className="text-[15px] font-bold text-rc-ink">
        {s.num}. {s.heading}
      </h3>
      <ol className="mt-2 space-y-2">
        {s.clauses.map((c) => (
          <li key={c.num} className="flex gap-3 text-sm leading-relaxed text-rc-ink/90">
            <span className="w-7 shrink-0 font-semibold text-rc-ink">{c.num}</span>
            <span>{c.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Table({ head, rows, groups }: { head: [string, string]; rows?: Array<[string, string]>; groups?: Array<{ heading: string; rows: Array<[string, string]> }> }) {
  const body = groups ?? [{ heading: "", rows: rows ?? [] }];
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-rc-border">
      <table className="w-full text-left text-[13px]">
        <thead className="bg-rc-bg-alt text-xs font-semibold text-rc-muted">
          <tr>
            <th className="px-3 py-2">{head[0]}</th>
            <th className="px-3 py-2">{head[1]}</th>
          </tr>
        </thead>
        {body.map((g) => (
          <tbody key={g.heading || "rows"} className="divide-y divide-rc-border border-t border-rc-border">
            {g.heading && (
              <tr>
                <th colSpan={2} className="bg-white px-3 pt-3 pb-1 text-[13px] font-bold text-rc-ink">
                  {g.heading}
                </th>
              </tr>
            )}
            {g.rows.map(([a, b]) => (
              <tr key={`${a}|${b}`} className="align-top">
                <td className="w-1/2 px-3 py-2 text-rc-ink">{a}</td>
                <td className="px-3 py-2 text-rc-muted">{b}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function AnnexureText() {
  return (
    <div>
      <h2 className="text-lg font-extrabold tracking-tight text-rc-ink">{SG_ANNEXURE_TITLE}</h2>
      <p className="mt-0.5 text-sm text-rc-muted">{SG_ANNEXURE_SUBTITLE}</p>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-rc-ink">
        {SG_ANNEXURE_NOTICE}
      </p>

      {SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES.map((s) => (
        <Section key={s.num} s={s} />
      ))}

      <section className="mt-6">
        <h3 className="text-[15px] font-bold text-rc-ink">{SG_ANNEXURE_SCHEDULE_1_HEADING}</h3>
        <p className="mt-1 text-xs text-rc-muted">{SG_ANNEXURE_SCHEDULE_1_LINE}</p>
        <Table
          head={["Record", "Provision it relates to"]}
          groups={scheduleOne().map((g) => ({ heading: g.heading, rows: g.rows.map((r) => [r.record, r.provision]) }))}
        />
      </section>

      <section className="mt-6">
        <h3 className="text-[15px] font-bold text-rc-ink">{SG_ANNEXURE_SCHEDULE_2_HEADING}</h3>
        <Table head={["Register", "What it holds"]} rows={SG_ANNEXURE_SCHEDULE_2.map((r) => [r.register, r.holds])} />
      </section>

      {SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES.map((s) => (
        <Section key={s.num} s={s} />
      ))}

      <section className="mt-6">
        <h3 className="text-[15px] font-bold text-rc-ink">{SG_ANNEXURE_ADOPTION.heading}</h3>
        <p className="mt-2 text-sm leading-relaxed text-rc-ink/90">{SG_ANNEXURE_ADOPTION.declaration}</p>
        <p className="mt-2 text-xs leading-relaxed text-rc-muted">{SG_ANNEXURE_ADOPTION.electronic}</p>
      </section>

      <section className="mt-6">
        <h3 className="text-[15px] font-bold text-rc-ink">{SG_ANNEXURE_AGENT_STATEMENT.heading}</h3>
        <p className="mt-1 text-xs italic text-rc-muted">{SG_ANNEXURE_AGENT_STATEMENT.note}</p>
        <p className="mt-2 text-sm leading-relaxed text-rc-ink/90">{SG_ANNEXURE_AGENT_STATEMENT.statement}</p>
      </section>
    </div>
  );
}
