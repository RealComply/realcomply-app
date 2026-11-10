import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";

// Edit a comparable's details (Adam, 10 Nov 2026; 0123).
//
// An "Edit details" link on each comparable sale changes its bedrooms,
// bathrooms, parking, land size, floor area, sold price and sale date. The
// edited figures are used from then on, the drafted reasoning included, and
// what was read from the report is kept: the database writes every change to
// property_comparable_changes, and the card and the compliance record say
//
//   Changed by Ana Agent, 10 November 2026: land size 650 m² (read from
//   report) to 210 m²
//
// This file is what a person may change, how a typed figure is read, and
// how a change is said. Plain text only, and no internal ids.

/** The seven figures, in the order the form and the record give them. */
export const DETAIL_FIELDS = [
  { key: "bedrooms", column: "bedrooms", label: "Bedrooms", said: "bedrooms" },
  { key: "bathrooms", column: "bathrooms", label: "Bathrooms", said: "bathrooms" },
  { key: "carSpaces", column: "car_spaces", label: "Parking", said: "parking" },
  { key: "landSizeSqm", column: "land_size_sqm", label: "Land size, m²", said: "land size" },
  { key: "internalAreaSqm", column: "internal_area_sqm", label: "Floor area, m²", said: "floor area" },
  { key: "salePrice", column: "sale_price", label: "Sold price", said: "sold price" },
  { key: "saleDate", column: "sale_date", label: "Sale date", said: "sale date" },
] as const;

export type DetailKey = (typeof DETAIL_FIELDS)[number]["key"];
export type DetailColumn = (typeof DETAIL_FIELDS)[number]["column"];

const BY_KEY = new Map<string, (typeof DETAIL_FIELDS)[number]>(DETAIL_FIELDS.map((f) => [f.key, f]));
const BY_COLUMN = new Map<string, (typeof DETAIL_FIELDS)[number]>(DETAIL_FIELDS.map((f) => [f.column, f]));

export function isDetailKey(k: string): k is DetailKey {
  return BY_KEY.has(k);
}

const WHOLE = new Set<DetailKey>(["bedrooms", "bathrooms", "carSpaces"]);

/**
 * A typed figure as it is stored: a whole number for the counts, a number
 * for the areas and the price, a real day for the date. Empty is "none".
 * The error is addressed to the person, in plain words.
 */
export function parseDetail(
  key: DetailKey,
  typed: string,
  today: string,
): { value: number | string | null } | { error: string } {
  const raw = typed.trim();
  if (!raw) return { value: null };
  const label = (BY_KEY.get(key) as (typeof DETAIL_FIELDS)[number]).said;

  if (key === "saleDate") {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const d = m ? new Date(`${raw}T00:00:00Z`) : null;
    if (!m || !d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
      return { error: "Give the sale date as a real day." };
    }
    if (raw > today) return { error: "The sale date can't be after today." };
    if (raw < "1950-01-01") return { error: "Check the sale date: it's too far back." };
    return { value: raw };
  }

  const n = Number(raw.replace(/[$,\s]/g, "").replace(/m²$|m2$|sqm$/i, ""));
  if (!Number.isFinite(n) || n < 0) return { error: `Give the ${label} as a number.` };
  if (WHOLE.has(key)) {
    if (!Number.isInteger(n) || n > 50) return { error: `Give the ${label} as a whole number, 0 to 50.` };
    return { value: n };
  }
  if (n === 0) return { error: `The ${label} can't be 0. Leave it empty if it isn't known.` };
  if (key === "salePrice") {
    if (n > 999_999_999) return { error: "Check the sold price: it's too large." };
    return { value: Math.round(n * 100) / 100 };
  }
  if (n > 9_999_999) return { error: `Check the ${label}: it's too large.` };
  return { value: Math.round(n * 100) / 100 };
}

/** One row of property_comparable_changes, as read back. */
export type ComparableChange = {
  comparableId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  wasFromReport: boolean;
  changedByName: string;
  changedAt: string;
};

function said(column: string, value: string | null): string {
  if (value === null || value === "") return "none";
  if (column === "sale_date") return formatAuDate(value.slice(0, 10));
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const shown = n.toLocaleString("en-AU", { maximumFractionDigits: 2 });
  if (column === "sale_price") return `$${shown}`;
  if (column === "land_size_sqm" || column === "internal_area_sqm") return `${shown} m²`;
  return shown;
}

/** "land size 650 m² (read from report) to 210 m²" */
export function changePhrase(c: Pick<ComparableChange, "field" | "oldValue" | "newValue" | "wasFromReport">): string {
  const f = BY_COLUMN.get(c.field);
  const name = f?.said ?? c.field.replace(/_/g, " ");
  const before =
    c.wasFromReport && (c.oldValue === null || c.oldValue === "")
      ? "none in the report"
      : `${said(c.field, c.oldValue)}${c.wasFromReport ? " (read from report)" : ""}`;
  return `${name} ${before} to ${said(c.field, c.newValue)}`;
}

/**
 * Each sale's changes as the record says them, oldest first: one line per
 * save, "Changed by [name], [date]: …", the figures in the form's order.
 */
export function changeLinesBySale(changes: ComparableChange[]): Map<string, string[]> {
  const order = new Map<string, number>(DETAIL_FIELDS.map((f, i) => [f.column, i]));
  const saves = new Map<string, ComparableChange[]>();
  for (const c of [...changes].sort((a, b) => a.changedAt.localeCompare(b.changedAt))) {
    const k = `${c.comparableId}|${c.changedAt}|${c.changedByName}`;
    const list = saves.get(k) ?? [];
    list.push(c);
    saves.set(k, list);
  }
  const out = new Map<string, string[]>();
  for (const list of saves.values()) {
    const first = list[0];
    const day = formatAuDate(sydneyDate(new Date(first.changedAt)));
    const phrases = [...list]
      .sort((a, b) => (order.get(a.field) ?? 99) - (order.get(b.field) ?? 99))
      .map(changePhrase);
    const line = `Changed by ${first.changedByName}, ${day}: ${phrases.join("; ")}`;
    out.set(first.comparableId, [...(out.get(first.comparableId) ?? []), line]);
  }
  return out;
}
