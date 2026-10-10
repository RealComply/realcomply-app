import type { SupabaseClient } from "@supabase/supabase-js";
import { pmOrigin, type PmGroup, type PmOrigin } from "@/lib/rules/nsw-pm";
import type { PmEngineInput, PmTick, PmTickState } from "@/lib/rules/pm-engine";

// Reads for the property management (PM) module (migration 0052). Shared by the
// pages and the server actions, so the action that enforces a lock reads the
// property exactly the way the page that drew it did.

export type PmPropertyRow = {
  id: string;
  agency_id: string;
  address: string;
  manager_id: string;
  origin: PmOrigin;
  grp: PmGroup;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type PmTenancyRow = {
  id: string;
  property_id: string;
  seq: number;
  before_stages: number[];
  move_in_date: string | null;
  vacate_date: string | null;
  move_out_date: string | null;
};

export type PmItemStateRow = {
  property_id: string;
  tenancy_id: string | null;
  item_key: string;
  state: PmTickState;
  changed_by: string;
  changed_at: string;
};

export type PmLoaded = {
  property: PmPropertyRow;
  /** The current (latest) tenancy. Null only if its row was never written. */
  tenancy: PmTenancyRow | null;
  input: PmEngineInput;
};

export type PmAgencySettings = { enabled: boolean; recordsSystem: string | null };

export async function pmAgencySettings(supabase: SupabaseClient, agencyId: string): Promise<PmAgencySettings> {
  const { data } = await supabase
    .from("agencies")
    .select("pm_enabled, pm_records_system")
    .eq("id", agencyId)
    .maybeSingle();
  // Before 0052 has run the columns do not exist and this errors; PM then
  // reads as off, which is the right answer.
  const row = data as { pm_enabled?: boolean; pm_records_system?: string | null } | null;
  return { enabled: row?.pm_enabled === true, recordsSystem: row?.pm_records_system ?? null };
}

/** The engine's view of one property, from its rows. */
export function pmEngineInput(
  property: Pick<PmPropertyRow, "origin" | "grp">,
  tenancy: PmTenancyRow | null,
  stateRows: PmItemStateRow[],
): PmEngineInput {
  const ticks: Record<string, PmTick> = {};
  for (const r of stateRows) {
    // Onboarding ticks belong to the property; everything else to the current tenancy.
    if (r.tenancy_id !== null && r.tenancy_id !== tenancy?.id) continue;
    ticks[r.item_key] = { state: r.state, changedBy: r.changed_by, changedAt: r.changed_at };
  }
  return {
    origin: property.origin,
    group: property.grp,
    tenancy: {
      beforeStages: tenancy?.before_stages ?? [...pmOrigin(property.origin).beforeStages],
      moveInDate: tenancy?.move_in_date ?? null,
      moveOutDate: tenancy?.move_out_date ?? null,
    },
    ticks,
  };
}

/** Latest tenancy per property. */
function currentTenancies(rows: PmTenancyRow[]): Map<string, PmTenancyRow> {
  const out = new Map<string, PmTenancyRow>();
  for (const t of rows) {
    const seen = out.get(t.property_id);
    if (!seen || t.seq > seen.seq) out.set(t.property_id, t);
  }
  return out;
}

export async function loadPmProperty(supabase: SupabaseClient, propertyId: string): Promise<PmLoaded | null> {
  const { data: property } = await supabase.from("pm_properties").select("*").eq("id", propertyId).maybeSingle();
  if (!property) return null;
  const [{ data: tenancies }, { data: states }] = await Promise.all([
    supabase.from("pm_tenancies").select("*").eq("property_id", propertyId),
    supabase
      .from("pm_item_states")
      .select("property_id, tenancy_id, item_key, state, changed_by, changed_at")
      .eq("property_id", propertyId),
  ]);
  const tenancy = currentTenancies((tenancies ?? []) as PmTenancyRow[]).get(propertyId) ?? null;
  const p = property as PmPropertyRow;
  return { property: p, tenancy, input: pmEngineInput(p, tenancy, (states ?? []) as PmItemStateRow[]) };
}

/** Engine input for a page of dashboard cards, in three queries however many cards. */
export async function loadPmCards(
  supabase: SupabaseClient,
  properties: PmPropertyRow[],
): Promise<Map<string, PmEngineInput>> {
  const ids = properties.map((p) => p.id);
  const out = new Map<string, PmEngineInput>();
  if (ids.length === 0) return out;
  const [{ data: tenancies }, { data: states }] = await Promise.all([
    supabase.from("pm_tenancies").select("*").in("property_id", ids),
    supabase
      .from("pm_item_states")
      .select("property_id, tenancy_id, item_key, state, changed_by, changed_at")
      .in("property_id", ids),
  ]);
  const current = currentTenancies((tenancies ?? []) as PmTenancyRow[]);
  const byProperty = new Map<string, PmItemStateRow[]>();
  for (const s of (states ?? []) as PmItemStateRow[]) {
    const list = byProperty.get(s.property_id) ?? [];
    list.push(s);
    byProperty.set(s.property_id, list);
  }
  for (const p of properties) {
    out.set(p.id, pmEngineInput(p, current.get(p.id) ?? null, byProperty.get(p.id) ?? []));
  }
  return out;
}

/**
 * The people this viewer can read, for the property manager picker and the
 * dashboard's cards. Not for names on ticks: since 0058 an agent can't read
 * the licensee's profile, so the property page names people from
 * agency_people instead (check, 10 Oct 2026).
 */
export type PmPerson = { id: string; name: string; archived: boolean };

export async function pmPeople(supabase: SupabaseClient): Promise<PmPerson[]> {
  const { data } = await supabase.from("profiles").select("id, full_name, email, archived_at").order("full_name");
  return ((data ?? []) as { id: string; full_name: string | null; email: string; archived_at: string | null }[]).map(
    (p) => ({ id: p.id, name: p.full_name?.trim() || p.email, archived: Boolean(p.archived_at) }),
  );
}
