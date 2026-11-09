"use client";

import { useActionState } from "react";
import { MapPin } from "lucide-react";
import { setCouncilArea } from "@/lib/actions/council-area";
import {
  COUNCIL_AREA_HINT,
  COUNCIL_AREA_QUESTION,
  METRO_COUNCILS,
  OTHER_NSW_COUNCILS,
  areaOf,
  councilAreaSource,
  councilAreaSummary,
  searchAreaLine,
  type CouncilAreaFrom,
} from "@/lib/rules/council-area";

// The listing's council area, for metro or non-metro (Reg s12A; 0118).

/** What the comparables card is told about the council area. */
export type CouncilAreaView = {
  council: string | null;
  from: CouncilAreaFrom | null;
  setByName: string | null;
  /** "9 November 2026". */
  setOn: string | null;
};

/** The 128 council areas, in two groups: the Regulation's metropolitan area, then the rest of NSW. */
export function CouncilAreaSelect({
  id,
  name = "councilArea",
  defaultValue,
  className = "",
  emptyLabel = "Choose the council area",
}: {
  id: string;
  name?: string;
  defaultValue?: string | null;
  className?: string;
  emptyLabel?: string;
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? ""}
      className={`w-full rounded-lg border border-rc-border bg-white px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft ${className}`}
    >
      <option value="">{emptyLabel}</option>
      <optgroup label="Metropolitan area (Reg s12A)">
        {[...METRO_COUNCILS].sort().map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </optgroup>
      <optgroup label="Rest of NSW (non-metropolitan)">
        {OTHER_NSW_COUNCILS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

/**
 * On the comparables card: the council area and where to look for comparable
 * sales, or the question when the planning certificate didn't give it. A
 * chosen one is changed in Edit listing, with the rest of the listing's details.
 */
export function CouncilAreaPanel({ propertyId, view }: { propertyId: string; view: CouncilAreaView }) {
  const [state, formAction, pending] = useActionState(setCouncilArea.bind(null, propertyId), { error: null });
  const kind = areaOf(view.council);

  if (view.council && kind) {
    return (
      <div className="mb-3 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5 text-xs leading-relaxed">
        <p className="flex items-start gap-1.5 font-semibold text-rc-ink">
          <MapPin size={13} className="mt-0.5 shrink-0 text-rc-green-deep" aria-hidden="true" />
          <span>Council area: {councilAreaSummary(view.council)}</span>
        </p>
        <p className="mt-1 text-rc-ink">{searchAreaLine(kind)}</p>
        <p className="mt-1 text-[11px] text-rc-muted">
          {councilAreaSource(view.from, view.setByName, view.setOn)} To change it, use <strong>Edit listing</strong> at
          the top of this page.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mb-3 rounded-lg border border-rc-amber/40 bg-rc-amber/10 px-3 py-2.5">
      <label htmlFor={`council-area-${propertyId}`} className="block text-xs font-semibold text-rc-ink">
        {COUNCIL_AREA_QUESTION}
      </label>
      <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">{COUNCIL_AREA_HINT}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <CouncilAreaSelect id={`council-area-${propertyId}`} className="max-w-xs flex-1" />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}
