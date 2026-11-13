import { SgDiff } from "@/components/sg/SgDiff";
import { comparedWith, missingLine, type Comparison } from "@/lib/sg-document/compare";

// A new full version compared with the live one (Adam's mockup, screen 4;
// part 3): an amendment not carried in is flagged first, then each section,
// with its before and after where it changed. Flags only: saving isn't blocked.

const TAG: Record<string, string> = {
  same: "border border-rc-border bg-rc-bg-alt text-rc-muted",
  changed: "border border-rc-amber-deep/30 bg-rc-amber/10 text-rc-amber-deep",
  new: "border border-rc-amber-deep/30 bg-rc-amber/10 text-rc-amber-deep",
  removed: "border border-rc-amber-deep/30 bg-rc-amber/10 text-rc-amber-deep",
  carried: "bg-rc-green-soft text-rc-green-deep",
  missing: "bg-red-100 text-red-700",
};

export function SgCompareVersions({
  comparison,
  liveLabel,
  newLabel,
}: {
  comparison: Comparison;
  liveLabel: string | null;
  newLabel: string | null;
}) {
  return (
    <div className="mt-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-rc-ink">New full version{newLabel?.trim() ? `: ${newLabel.trim()}` : ""}</h3>
        <p className="text-xs text-rc-muted">{comparedWith(liveLabel, comparison.amendmentCount)}</p>
      </div>
      {comparison.missing.map((m) => {
        const line = missingLine(m, newLabel);
        return (
          <p key={m.ref} role="note" className="rounded-xl border border-rc-amber-deep/25 bg-rc-amber/10 px-3.5 py-2.5 text-sm text-rc-ink">
            <span className="font-semibold text-rc-amber-deep">{line.head}</span> {line.body}
          </p>
        );
      })}
      <div className="overflow-x-auto rounded-xl border border-rc-border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-rc-border text-[11px] uppercase tracking-wide text-rc-faint">
              <th className="px-3 py-2 font-semibold">Section</th>
              <th className="px-3 py-2 font-semibold">Change</th>
              <th className="px-3 py-2 font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((r) => (
              <tr key={r.key} className="border-b border-rc-border align-top last:border-b-0">
                <td className="px-3 py-2 font-semibold text-rc-ink">{r.section}</td>
                <td className="px-3 py-2">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${TAG[r.change]}`}>{r.tag}</span>
                </td>
                <td className="px-3 py-2 text-rc-muted">
                  {r.detail.map((d) => (
                    <p key={d}>{d}</p>
                  ))}
                  {r.before !== undefined && r.after !== undefined && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs font-semibold text-rc-green-deep">Show before and after</summary>
                      <div className="mt-2">
                        <SgDiff before={r.before} after={r.after} />
                      </div>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
