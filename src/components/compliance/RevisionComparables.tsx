"use client";

import { useMemo, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import type { AreaKind } from "@/lib/rules/council-area";
import {
  COMPARISON_FACTORS,
  FACTORS_LABEL,
  FEWER_THAN_THREE_HINT,
  FEWER_THAN_THREE_LABEL,
  INFORMATION_USED_HINT,
  INFORMATION_USED_LABEL,
  MAX_MOST_COMPARABLE,
  MOST_COMPARABLE_LABEL,
  MOST_COMPARABLE_REASON_LABEL,
  TIE_HINT,
  windowCheck,
} from "@/lib/rules/comparables-rules";
import {
  NOT_BEFORE_LABEL,
  REVISION_COMPARABLES_HINT,
  REVISION_COMPARABLES_LABEL,
  addressKey,
  saleLine,
  type RevisionCandidate,
} from "@/lib/rules/revision-comparables";
import { DateBox } from "@/components/DateBox";
import { sydneyDate } from "@/lib/format-date";

// A revision's own comparable sales (Reg s12G(1)(a), (c), (d); 0120), in the
// form that records the revision. Sent as one JSON list (revisionComparables)
// with the information used and why fewer than 3. Nothing is pre-ticked: each
// sale taken into account is the agent's tick.


type Row = RevisionCandidate & {
  typed: boolean;
  taken: boolean;
  most: boolean;
  mostReason: string;
  factors: string[];
  notBeforeReason: string;
  /** Typed rows only: what's in the boxes. */
  priceText: string;
  distanceText: string;
};

const fromCandidate = (c: RevisionCandidate): Row => ({
  ...c,
  typed: false,
  taken: false,
  most: false,
  mostReason: "",
  factors: [],
  notBeforeReason: "",
  priceText: "",
  distanceText: "",
});

const sydneyToday = () => sydneyDate();

const inputClass =
  "w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm text-rc-ink focus:border-rc-green-deep focus:outline-none";

export function RevisionComparablesFields({
  candidates,
  previousAddresses,
  kind,
  givenOn,
  underReforms,
}: {
  candidates: RevisionCandidate[];
  /** The sales the previous ESP was worked out from. */
  previousAddresses: string[];
  kind: AreaKind | null;
  /** The date the notice was given, as typed: what the months count back from. */
  givenOn: string;
  underReforms: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => candidates.map(fromCandidate));
  const [added, setAdded] = useState(0);
  const before = useMemo(() => new Set(previousAddresses.map(addressKey)), [previousAddresses]);
  const asAt = /^\d{4}-\d{2}-\d{2}$/.test(givenOn) ? givenOn : sydneyToday();
  const mostCount = rows.filter((r) => r.taken && r.most).length;

  const set = (key: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const toggleFactor = (key: string, factor: string) =>
    setRows((all) =>
      all.map((r) =>
        r.key === key ? { ...r, factors: r.factors.includes(factor) ? r.factors.filter((f) => f !== factor) : [...r.factors, factor] } : r,
      ),
    );
  const addSale = () => {
    const key = `typed-${added}`;
    setAdded((n) => n + 1);
    setRows((all) => [
      ...all,
      { ...fromCandidate({ key, address: "", soldOn: null, soldPrice: null, distanceM: null }), typed: true, taken: true },
    ]);
  };

  const payload = rows
    .filter((r) => r.taken && (!r.typed || r.address.trim()))
    .map((r) => ({
      address: r.address.trim(),
      soldOn: r.soldOn || null,
      soldPrice: r.typed ? r.priceText : r.soldPrice,
      distanceM: r.typed ? r.distanceText : r.distanceM,
      most: r.most,
      mostReason: r.most ? r.mostReason : null,
      factors: r.most ? r.factors : [],
      notBeforeReason: before.has(addressKey(r.address)) ? null : r.notBeforeReason || null,
    }));

  return (
    <div className="space-y-2.5 rounded-md border border-rc-border bg-rc-bg-alt px-3 py-2.5">
      <input type="hidden" name="revisionComparables" value={JSON.stringify(payload)} />
      <div>
        <p className="text-xs font-semibold text-rc-ink">{REVISION_COMPARABLES_LABEL}</p>
        <p className="text-[11px] leading-relaxed text-rc-faint">
          {REVISION_COMPARABLES_HINT} {TIE_HINT}
          {underReforms ? "" : " Asked for from 17 November 2026."}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-rc-ink">
          <Star size={12} className="shrink-0 text-rc-green-deep" aria-hidden="true" />
          Marked as the most comparable: {mostCount} of {MAX_MOST_COMPARABLE}
        </p>
      </div>

      {rows.length === 0 && (
        <p className="text-[11px] italic text-rc-faint">No comparable sales on this listing yet. Add the ones you used.</p>
      )}

      {rows.map((r) => {
        const isNew = r.taken && r.address.trim() !== "" && !before.has(addressKey(r.address));
        const place = kind && !r.typed ? windowCheck({ distanceM: r.distanceM, saleDate: r.soldOn }, kind, asAt) : null;
        const full = mostCount >= MAX_MOST_COMPARABLE && !r.most;
        return (
          <div key={r.key} className={`rounded-md border bg-white px-2.5 py-2 ${r.taken ? "border-rc-green-deep/35" : "border-rc-border"}`}>
            {r.typed ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Address of the sale"
                    placeholder="14 Smith St, Mount Colah"
                    value={r.address}
                    onChange={(e) => set(r.key, { address: e.target.value })}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                    aria-label="Take this sale off"
                    className="shrink-0 rounded-full p-1 text-rc-faint hover:bg-rc-bg-alt hover:text-rc-ink"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-rc-muted">
                    Date sold
                    <DateBox value={r.soldOn ?? ""} onChange={(e) => set(r.key, { soldOn: e.target.value || null })} className={inputClass} />
                  </label>
                  <label className="text-[11px] text-rc-muted">
                    Sold price
                    <input inputMode="decimal" value={r.priceText} onChange={(e) => set(r.key, { priceText: e.target.value })} className={inputClass} />
                  </label>
                  <label className="text-[11px] text-rc-muted">
                    Distance (m)
                    <input inputMode="numeric" value={r.distanceText} onChange={(e) => set(r.key, { distanceText: e.target.value })} className={inputClass} />
                  </label>
                </div>
              </div>
            ) : (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={r.taken}
                  onChange={(e) => set(r.key, e.target.checked ? { taken: true } : { taken: false, most: false })}
                  className="mt-0.5 shrink-0 accent-rc-green-deep"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-rc-ink">{saleLine(r)}</span>
                  {place && (
                    <span className={`block text-[11px] ${place.place === "recent" ? "text-rc-green-deep" : place.place === "earlier" ? "text-rc-muted" : "text-rc-amber-deep"}`}>
                      {place.label}
                    </span>
                  )}
                  <span className="block text-[11px] text-rc-faint">
                    {r.taken ? "Taken into account for this revision" : "Tick if you took it into account for this revision"}
                  </span>
                </span>
              </label>
            )}

            {r.taken && (
              <div className="mt-2 space-y-2 pl-6">
                {isNew && (
                  <label className="block text-[11px] font-semibold text-rc-ink">
                    {NOT_BEFORE_LABEL}
                    <input
                      value={r.notBeforeReason}
                      onChange={(e) => set(r.key, { notBeforeReason: e.target.value })}
                      placeholder="For example: it sold after the previous ESP was worked out."
                      className={`mt-1 ${inputClass}`}
                    />
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-rc-green-deep">
                  <input
                    type="checkbox"
                    checked={r.most}
                    disabled={full}
                    onChange={(e) => set(r.key, { most: e.target.checked })}
                    className="shrink-0 accent-rc-green-deep"
                  />
                  {MOST_COMPARABLE_LABEL}
                  {full && <span className="font-normal text-rc-faint">(3 are marked already)</span>}
                </label>
                {r.most && (
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-semibold text-rc-ink">
                      {MOST_COMPARABLE_REASON_LABEL}
                      <input value={r.mostReason} onChange={(e) => set(r.key, { mostReason: e.target.value })} className={`mt-1 ${inputClass}`} />
                    </label>
                    <fieldset>
                      <legend className="text-[11px] font-semibold text-rc-ink">{FACTORS_LABEL}</legend>
                      <div className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-2">
                        {COMPARISON_FACTORS.map((f) => (
                          <label key={f.key} className="flex items-start gap-1.5 text-[11px] leading-snug text-rc-ink">
                            <input
                              type="checkbox"
                              checked={r.factors.includes(f.key)}
                              onChange={() => toggleFactor(r.key, f.key)}
                              className="mt-0.5 shrink-0 accent-rc-green-deep"
                            />
                            <span>{f.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={addSale}
        className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink hover:border-rc-ink/20"
      >
        <Plus size={12} aria-hidden="true" />
        Add a sale
      </button>

      <label className="block text-[11px] font-semibold text-rc-ink">
        {INFORMATION_USED_LABEL}
        <span className="mt-0.5 block font-normal text-rc-faint">{INFORMATION_USED_HINT}</span>
        <textarea name="comparablesInfoUsed" rows={2} className={`mt-1 ${inputClass}`} />
      </label>
      {mostCount < MAX_MOST_COMPARABLE && (
        <label className="block text-[11px] font-semibold text-rc-ink">
          {FEWER_THAN_THREE_LABEL}
          <span className="mt-0.5 block font-normal text-rc-faint">{FEWER_THAN_THREE_HINT}</span>
          <textarea name="comparablesFewerReason" rows={2} className={`mt-1 ${inputClass}`} />
        </label>
      )}
    </div>
  );
}
