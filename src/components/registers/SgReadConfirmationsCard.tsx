import { BookOpenCheck } from "lucide-react";
import { formatSignedAt } from "@/lib/pdf/sign-stamp";
import type { SgReadConfirmation } from "@/lib/types";

// The agents' read-and-tick of the annexure and the Supervision Guidelines,
// in Registers, Document sign-offs (brief, 14 Oct 2026): agent name, date and
// time, annexure version. The agent sees their own; the licensee in charge
// sees the office's (0069's policy decides which rows arrive).

export function SgReadConfirmationsCard({
  confirmations,
  nameOf,
}: {
  confirmations: SgReadConfirmation[];
  nameOf: (id: string | null) => string;
}) {
  if (confirmations.length === 0) return null;
  const rows = [...confirmations].sort((a, b) => b.confirmed_at.localeCompare(a.confirmed_at));
  return (
    <section className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rc-green-soft text-rc-green-deep">
          <BookOpenCheck size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-rc-ink">Read: the RealComply annexure and the Supervision Guidelines</h3>
          <p className="mt-0.5 text-xs text-rc-muted">
            Agents who ticked &ldquo;I&rsquo;ve read the RealComply annexure and my office&rsquo;s Supervision
            Guidelines.&rdquo;
          </p>
          <ul className="mt-3 divide-y divide-rc-border text-sm">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                <span className="font-medium text-rc-ink">{nameOf(c.confirmed_by)}</span>
                <span className="text-rc-muted">
                  {formatSignedAt(c.confirmed_at)} · annexure version {c.annexure_version}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
