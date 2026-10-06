"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Info } from "lucide-react";
import { setPmItem } from "@/lib/actions/pm";
import { formatAuDateTimeShort } from "@/lib/format-date";
import type { PmResolvedItem } from "@/lib/rules/nsw-pm";
import type { PmTickState } from "@/lib/rules/pm-engine";

// One PM item: a tick box, the title, and one help line (brief A6).
//
// Ticking records the person and the time, shown under the title like
// "✓ Sue Edwards · 6 Oct 2026, 2:15 pm"; the title is struck through and the
// help line hides. Unticking is allowed and is kept in the history (0052).
// N/A is offered only where the rules say so, records the person and the time,
// and counts the item out of the stage total. The person is always whoever is
// signed in: there is no "ticking as" picker. No upload, no attach: RealComply
// holds no PM documents.
//
// The legal reference sits behind the "i", the way the sales cards fold theirs.
//
// An item RealComply has marked N/A itself (the tenant ended the tenancy, or
// the ground carries no exclusion period; brief B1) shows the reason and
// cannot be ticked.

export type PmRowTick = { state: PmTickState; byName: string; at: string } | null;

export function PmItemRow({
  propertyId,
  item,
  tick,
  viewerName,
  striped,
  outgoingTenancyId,
}: {
  propertyId: string;
  item: PmResolvedItem;
  tick: PmRowTick;
  viewerName: string;
  striped: boolean;
  /** Set for an outgoing tenant's Exit item (brief B2). */
  outgoingTenancyId?: string;
}) {
  const [optimistic, setOptimistic] = useOptimistic(tick);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);

  const state = optimistic?.state ?? "open";
  const done = state === "done";
  const na = state === "na";

  function change(next: PmTickState) {
    setError(null);
    startTransition(async () => {
      setOptimistic(next === "open" ? null : { state: next, byName: viewerName, at: new Date().toISOString() });
      const result = await setPmItem(propertyId, item.key, next, outgoingTenancyId ?? null);
      if (result.error) setError(result.error);
    });
  }

  const id = `pm-${outgoingTenancyId ? `${outgoingTenancyId}-` : ""}${item.key}`;

  if (item.auto) {
    return (
      <li className={`flex items-start gap-3 border-t border-rc-border px-4 py-3 ${striped ? "bg-rc-bg-alt" : ""}`}>
        <input type="checkbox" checked={false} disabled aria-label={`${item.title}: N/A`} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rc-muted line-through">{item.title}</p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-rc-muted">N/A · {item.auto.note}</p>
        </div>
      </li>
    );
  }

  return (
    <li className={`flex items-start gap-3 border-t border-rc-border px-4 py-3 ${striped ? "bg-rc-bg-alt" : ""}`}>
      <input
        id={id}
        type="checkbox"
        checked={done}
        disabled={na || pending}
        onChange={(e) => change(e.target.checked ? "done" : "open")}
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-rc-green-deep disabled:cursor-default"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <label
            htmlFor={id}
            className={`cursor-pointer text-sm ${done || na ? "font-medium text-rc-muted line-through" : "font-semibold text-rc-ink"}`}
          >
            {item.title}
          </label>
          <button
            type="button"
            onClick={() => setShowRef((s) => !s)}
            aria-expanded={showRef}
            aria-label={`Legal basis for ${item.title}`}
            className="mt-px shrink-0 rounded-full p-0.5 text-rc-faint transition hover:text-rc-green-deep"
          >
            <Info size={13} aria-hidden="true" />
          </button>
        </div>
        {!done && !na && (
          <p className="text-[13px] text-rc-muted">
            {item.help}
            {item.naAllowed ? " (only if it applies)" : ""}
          </p>
        )}
        {showRef && <p className="mt-0.5 text-xs text-rc-faint">Legal basis: {item.reference}</p>}
        {optimistic && done && (
          <p className="mt-0.5 text-[12.5px] font-semibold text-rc-green-deep">
            ✓ {optimistic.byName} · {formatAuDateTimeShort(optimistic.at)}
          </p>
        )}
        {optimistic && na && (
          <p className="mt-0.5 text-[12.5px] font-semibold text-rc-muted">
            N/A · {optimistic.byName} · {formatAuDateTimeShort(optimistic.at)}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs font-medium text-rc-red">
            {error}
          </p>
        )}
      </div>
      {item.naAllowed && !done && (
        <button
          type="button"
          disabled={pending}
          onClick={() => change(na ? "open" : "na")}
          aria-pressed={na}
          className={`shrink-0 rounded-full border px-3 py-0.5 text-xs transition ${
            na ? "border-rc-muted bg-rc-muted text-white" : "border-rc-border bg-white text-rc-muted hover:text-rc-ink"
          }`}
        >
          {na ? "Undo N/A" : "N/A"}
        </button>
      )}
    </li>
  );
}

