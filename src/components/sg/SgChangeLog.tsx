import type { ChangeLogRow } from "@/lib/sg-document/change-log";

// The change log (Adam's mockup, screen 5): every version and every
// amendment, newest first, with when it starts, what changed, why, who
// approved it and how many staff have signed. "Reviewed, no changes needed"
// joins it in part 4, and the Export PDF puts it at the back.
export function SgChangeLog({ rows }: { rows: ChangeLogRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section id="sg-change-log" className="scroll-mt-4">
      <h2 className="text-lg font-bold tracking-tight text-rc-ink">Change log</h2>
      <p className="mt-0.5 text-sm text-rc-muted">Every version, amendment and &ldquo;Reviewed, no changes needed&rdquo;, with the date it starts.</p>
      <div className="mt-3 overflow-x-auto rounded-card border border-rc-border bg-white shadow-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-rc-border text-[11px] uppercase tracking-wide text-rc-faint">
              <th className="px-3 py-2 font-semibold">Starts</th>
              <th className="px-3 py-2 font-semibold">Ref</th>
              <th className="px-3 py-2 font-semibold">Document</th>
              <th className="px-3 py-2 font-semibold">What changed</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
              <th className="px-3 py-2 font-semibold">Approved by</th>
              <th className="px-3 py-2 font-semibold">Staff signed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-rc-border align-top last:border-b-0">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-rc-muted">{r.starts}</td>
                <td className="px-3 py-2 font-bold text-rc-ink">{r.ref}</td>
                <td className="px-3 py-2 text-rc-muted">{r.document}</td>
                <td className="px-3 py-2 text-rc-ink">{r.whatChanged}</td>
                <td className="px-3 py-2 text-rc-muted">{r.reason}</td>
                <td className="px-3 py-2 text-rc-muted">{r.approvedBy}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums text-rc-muted">{r.staffSigned}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
