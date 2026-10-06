import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPmEndedBy,
  isPmGround,
  pmOrigin,
  type PmGroup,
  type PmManagementEndedReason,
  type PmOrigin,
} from "@/lib/rules/nsw-pm";
import type { PmEngineInput, PmTenancyInput, PmTick, PmTickState, PmTicks } from "@/lib/rules/pm-engine";

// Reads for the property management (PM) module (migrations 0052, 0053). Shared by the
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
  management_ended_on?: string | null;
  management_ended_reason?: PmManagementEndedReason | null;
};

export type PmTenancyRow = {
  id: string;
  property_id: string;
  seq: number;
  before_stages: number[];
  move_in_date: string | null;
  vacate_date: string | null;
  move_out_date: string | null;
  ended_by?: string | null;
  termination_ground?: string | null;
  created_at?: string;
};

export type PmItemStateRow = {
  property_id: string;
  tenancy_id: string | null;
  item_key: string;
  state: PmTickState;
  detail?: Record<string, unknown> | null;
  changed_by: string;
  changed_at: string;
};

export type PmRecordRow = {
  id: string;
  property_id: string;
  tenancy_id: string;
  kind: "property_sold" | "advertising_photos" | "details_change" | "pet_request" | "pet_application";
  data: { received?: string; outcome?: string; ground?: string | null };
  recorded_by: string;
  recorded_at: string;
  response_given_by: string | null;
  response_given_at: string | null;
};

export type PmLoaded = {
  property: PmPropertyRow;
  /** The current (latest) tenancy. Null only if its row was never written. */
  tenancy: PmTenancyRow | null;
  /** Every tenancy, oldest first. */
  tenancies: PmTenancyRow[];
  /** Every current tick row, for every tenancy. */
  states: PmItemStateRow[];
  input: PmEngineInput;
};

const STATE_COLUMNS = "property_id, tenancy_id, item_key, state, detail, changed_by, changed_at";

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

/** The engine's view of one tenancy row. */
export function pmTenancyInput(t: PmTenancyRow): PmTenancyInput {
  return {
    seq: t.seq,
    beforeStages: t.before_stages,
    moveInDate: t.move_in_date,
    moveOutDate: t.move_out_date,
    endedBy: isPmEndedBy(t.ended_by) ? t.ended_by : null,
    ground: isPmGround(t.termination_ground) ? t.termination_ground : null,
  };
}

/** One tenancy's own ticks (onboarding ticks, which belong to the property, left out). */
export function pmTenancyTicks(tenancyId: string, stateRows: PmItemStateRow[]): PmTicks {
  const ticks: PmTicks = {};
  for (const r of stateRows) {
    if (r.tenancy_id !== tenancyId) continue;
    ticks[r.item_key] = { state: r.state, changedBy: r.changed_by, changedAt: r.changed_at };
  }
  return ticks;
}

/** The engine's view of one property, from its rows. */
export function pmEngineInput(
  property: Pick<PmPropertyRow, "origin" | "grp">,
  tenancy: PmTenancyRow | null,
  stateRows: PmItemStateRow[],
  allTenancies: PmTenancyRow[] = [],
): PmEngineInput {
  const ticks: Record<string, PmTick> = {};
  for (const r of stateRows) {
    // Onboarding ticks belong to the property; everything else to the current tenancy.
    if (r.tenancy_id !== null && r.tenancy_id !== tenancy?.id) continue;
    ticks[r.item_key] = { state: r.state, changedBy: r.changed_by, changedAt: r.changed_at };
  }
  const previous = allTenancies
    .filter((t) => tenancy && t.seq < tenancy.seq)
    .sort((a, b) => a.seq - b.seq)
    .map((t) => ({ tenancyId: t.id, tenancy: pmTenancyInput(t), ticks: pmTenancyTicks(t.id, stateRows) }));
  return {
    origin: property.origin,
    group: property.grp,
    tenancy: tenancy
      ? pmTenancyInput(tenancy)
      : { seq: 1, beforeStages: [...pmOrigin(property.origin).beforeStages], moveInDate: null, moveOutDate: null },
    ticks,
    previous,
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
  const [{ data: tenancyRows }, { data: stateRows }] = await Promise.all([
    supabase.from("pm_tenancies").select("*").eq("property_id", propertyId),
    supabase.from("pm_item_states").select(STATE_COLUMNS).eq("property_id", propertyId),
  ]);
  const tenancies = ((tenancyRows ?? []) as PmTenancyRow[]).sort((a, b) => a.seq - b.seq);
  const states = (stateRows ?? []) as PmItemStateRow[];
  const tenancy = currentTenancies(tenancies).get(propertyId) ?? null;
  const p = property as PmPropertyRow;
  return { property: p, tenancy, tenancies, states, input: pmEngineInput(p, tenancy, states, tenancies) };
}

/** Everything recorded on a property (Stage 4 events, pet requests, pets on applications), oldest first. */
export async function loadPmRecords(supabase: SupabaseClient, propertyId: string): Promise<PmRecordRow[]> {
  const { data } = await supabase
    .from("pm_records")
    .select("*")
    .eq("property_id", propertyId)
    .order("recorded_at", { ascending: true });
  return (data ?? []) as PmRecordRow[];
}

/** The current answers to an item that is more than a tick, for one tenancy. */
export function pmItemDetail(states: PmItemStateRow[], tenancyId: string | undefined, itemKey: string) {
  const row = states.find((r) => r.tenancy_id === tenancyId && r.item_key === itemKey);
  return row ? { state: row.state, detail: row.detail ?? {}, changedBy: row.changed_by, changedAt: row.changed_at } : null;
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
    supabase.from("pm_item_states").select(STATE_COLUMNS).in("property_id", ids),
  ]);
  const allTenancies = (tenancies ?? []) as PmTenancyRow[];
  const current = currentTenancies(allTenancies);
  const byProperty = new Map<string, PmItemStateRow[]>();
  for (const s of (states ?? []) as PmItemStateRow[]) {
    const list = byProperty.get(s.property_id) ?? [];
    list.push(s);
    byProperty.set(s.property_id, list);
  }
  for (const p of properties) {
    out.set(
      p.id,
      pmEngineInput(
        p,
        current.get(p.id) ?? null,
        byProperty.get(p.id) ?? [],
        allTenancies.filter((t) => t.property_id === p.id),
      ),
    );
  }
  return out;
}

/** The agency's people, for names on ticks and the property manager picker. */
export type PmPerson = { id: string; name: string; archived: boolean };

export async function pmPeople(supabase: SupabaseClient): Promise<PmPerson[]> {
  const { data } = await supabase.from("profiles").select("id, full_name, email, archived_at").order("full_name");
  return ((data ?? []) as { id: string; full_name: string | null; email: string; archived_at: string | null }[]).map(
    (p) => ({ id: p.id, name: p.full_name?.trim() || p.email, archived: Boolean(p.archived_at) }),
  );
}
