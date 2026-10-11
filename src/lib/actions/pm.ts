"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { ActionState } from "@/lib/actions/auth";
import { loadPmProperty, pmAgencySettings } from "@/lib/data/pm";
import { agencyPeople } from "@/lib/data/people";
import {
  PM_EVENT_RECORDS,
  PM_PET_APPLICATION,
  PM_PET_REQUEST,
  isPmEndedBy,
  isPmGround,
  isPmManagementEndedReason,
  isPmOrigin,
  isPmPetGround,
  pmGroupLabel,
  pmItemStage,
  pmOrigin,
  pmWaterClean,
  pmWaterResult,
} from "@/lib/rules/nsw-pm";
import {
  pmCanAnswerWater,
  pmCanRecord,
  pmCanSetItem,
  pmMoveCheck,
  pmOutgoing,
  type PmTickState,
} from "@/lib/rules/pm-engine";

// Server actions for property management (PM), Parts A and B. Brief:
// claude/RealComply-PM-build-brief-6-Oct.md.
//
// Every tick and every move is checked here against the same engine the page
// draws from (lib/rules/pm-engine.ts), so a locked stage stays locked even if
// someone calls the action directly (brief A7). The database adds the agency
// lock, the who-and-when stamp and the history (migration 0052).

const PM_OFF = "Property management is not switched on for this agency.";

async function requirePm() {
  const ctx = await requireAuthContext();
  if (ctx.profile.archived_at) redirect("/login");
  const settings = await pmAgencySettings(ctx.supabase, ctx.profile.agency_id);
  return { ...ctx, pmEnabled: settings.enabled };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Where this office keeps its PM records ("PropertyMe"). Named once per agency. */
export async function setPmRecordsSystem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, pmEnabled, access } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };
  // Licensee only (Adam, 9 Oct 2026); checked in the database too (0058).
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can change the records system." };
  const name = String(formData.get("recordsSystem") ?? "").trim();
  if (name.length > 80) return { error: "Keep the name under 80 characters." };
  const { error } = await supabase.rpc("set_agency_pm_records_system", { p_name: name });
  if (error) return { error: "Couldn't save that. Try again." };
  revalidatePath("/dashboard/pm", "layout");
  return { error: null };
}

/** "+ Add property": the address, one of the three kinds, and its property manager. */
export async function addPmProperty(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user, profile, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const address = String(formData.get("address") ?? "").trim();
  const originValue = String(formData.get("origin") ?? "");
  const managerId = String(formData.get("managerId") ?? "") || user.id;

  if (!address) return { error: "Enter the property's address." };
  if (!isPmOrigin(originValue)) return { error: "Choose New management, Existing tenanted or Existing vacant." };
  const origin = pmOrigin(originValue);

  // The manager has to be a current member of this agency. RLS only shows
  // this agency's people, so a profile from elsewhere simply is not found.
  const { data: manager } = await supabase
    .from("profiles")
    .select("id, archived_at")
    .eq("id", managerId)
    .maybeSingle();
  if (!manager || manager.archived_at) return { error: "Choose a property manager from your office." };

  const { data: created, error } = await supabase
    .from("pm_properties")
    .insert({
      agency_id: profile.agency_id,
      address,
      manager_id: managerId,
      origin: origin.key,
      grp: origin.startsIn,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      error: error?.message?.includes("subscription")
        ? error.message
        : "Couldn't add that property. Try again.",
    };
  }

  // The first tenancy. "Before RealComply" stages are written here, once, so
  // the property says what it was when it arrived.
  await supabase.from("pm_tenancies").insert({
    agency_id: profile.agency_id,
    property_id: created.id,
    seq: 1,
    before_stages: origin.beforeStages,
  });

  revalidatePath("/dashboard/pm");
  redirect(`/dashboard/pm/${created.id}`);
}

/**
 * Hands a property to another property manager. The licensee's alone.
 *
 * There was no way to do this (check, 10 Oct 2026). A property is filed
 * under one manager when it is added, and archiving someone hands theirs to
 * the licensee (team.ts), where they stayed for good: moving one on to the
 * agent now looking after it, or back to someone brought back, meant editing
 * the database. Same people as the "+ Add property" picker offers the
 * licensee: anyone active in the office.
 *
 * Not written to a history table: PM keeps one for ticks (pm_item_events)
 * and one for group moves (pm_group_moves), and neither is for this.
 */
export async function changePmManager(propertyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, pmEnabled, access } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can change the property manager." };

  const managerId = String(formData.get("managerId") ?? "");
  // Names and whether they have left, for everyone in the office (0058).
  const person = (await agencyPeople(supabase)).find((p) => p.id === managerId);
  if (!person || person.archived_at) return { error: "Choose a property manager from your office." };

  const { data: changed, error } = await supabase
    .from("pm_properties")
    .update({ manager_id: managerId })
    .eq("id", propertyId)
    .select("id");
  if (error || !changed || changed.length === 0) return { error: "Couldn't change the property manager. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}

/** The tenancy a per-tenancy tick belongs to, writing the first one if it is missing. */
async function ensureTenancyId(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
  loaded: NonNullable<Awaited<ReturnType<typeof loadPmProperty>>>,
): Promise<string | null> {
  if (loaded.tenancy) return loaded.tenancy.id;
  const { data } = await supabase
    .from("pm_tenancies")
    .insert({
      agency_id: loaded.property.agency_id,
      property_id: loaded.property.id,
      seq: 1,
      before_stages: loaded.input.tenancy.beforeStages,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

/**
 * Tick, N/A or untick one item. The person and the time are stamped by the
 * database (0052) from whoever is signed in; every change is kept in the
 * history by a trigger, so nothing is ever silently lost.
 */
export async function setPmItem(
  propertyId: string,
  itemKey: string,
  next: PmTickState,
  outgoingTenancyId?: string | null,
): Promise<ActionState> {
  const { supabase, user, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };
  if (next !== "done" && next !== "na" && next !== "open") return { error: "Something went wrong. Try again." };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };

  // The lock, on the server. An outgoing tenancy's Exit is never locked, but
  // it has to be an outgoing tenancy of this property (brief B2).
  const refusal = pmCanSetItem(loaded.input, itemKey, next, outgoingTenancyId ?? null);
  if (refusal) return { error: refusal };

  // Onboarding ticks belong to the property (done once); the rest to the tenancy.
  const isOnboarding = pmItemStage(itemKey)?.scope === "property";
  const tenancyId = isOnboarding
    ? null
    : outgoingTenancyId
      ? outgoingTenancyId
      : await ensureTenancyId(supabase, loaded);
  if (!isOnboarding && !tenancyId) return { error: "Couldn't save that. Try again." };

  let existing = supabase
    .from("pm_item_states")
    .select("id")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey);
  existing = tenancyId ? existing.eq("tenancy_id", tenancyId) : existing.is("tenancy_id", null);
  const { data: row } = await existing.maybeSingle();

  const { error } = row
    ? await supabase.from("pm_item_states").update({ state: next, changed_by: user.id }).eq("id", row.id)
    : await supabase.from("pm_item_states").insert({
        agency_id: loaded.property.agency_id,
        property_id: propertyId,
        tenancy_id: tenancyId,
        item_key: itemKey,
        state: next,
        changed_by: user.id,
      });
  if (error) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}

/**
 * A move between groups (brief A9, B1 to B3): Put up for lease, Tenant has
 * moved in, Tenant is vacating (with who is ending it and the ground), Tenant
 * has moved out, Put up for lease now, Put back up for lease, Management has
 * ended. Re-leasing starts a new tenancy; the old one is kept as it was.
 */
export async function movePmProperty(propertyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };

  const moveKey = String(formData.get("move") ?? "");
  const check = pmMoveCheck(loaded.input, moveKey);
  // Someone else may have moved it since the page was drawn.
  if (!check || String(formData.get("from") ?? "") !== check.move.from) {
    return {
      error:
        loaded.property.grp === "archived"
          ? "This management has ended."
          : `This property has moved on since the page loaded (it is now in ${pmGroupLabel(loaded.property.grp)}). Refresh to see where it is now.`,
    };
  }
  if (check.line) return { error: check.line };
  const move = check.move;

  // What the move asks for, checked before anything is written.
  let eventDate: string | null = null;
  const tenancyUpdate: Record<string, string | null> = {};
  const propertyUpdate: Record<string, string | null> = { grp: move.to };

  if (move.asks === "date" || move.asks === "vacating" || move.asks === "managementEnded") {
    eventDate = String(formData.get("date") ?? "").trim();
    const label = move.date?.label ?? "Date management ended";
    if (!isIsoDate(eventDate)) return { error: `Enter the ${label.toLowerCase()}.` };
  }
  if (move.date && eventDate) {
    const moveIn = loaded.tenancy?.move_in_date;
    if (move.date.field === "move_out_date" && moveIn && eventDate < moveIn) {
      return { error: "The move-out date can't be before the move-in date." };
    }
    tenancyUpdate[move.date.field] = eventDate;
  }
  if (move.asks === "vacating") {
    // Who is ending it (brief B1). The landlord: the ground too.
    const endedBy = String(formData.get("endedBy") ?? "");
    if (!isPmEndedBy(endedBy)) return { error: "Choose who is ending the tenancy: the tenant or the landlord." };
    tenancyUpdate.ended_by = endedBy;
    tenancyUpdate.termination_ground = null;
    if (endedBy === "landlord") {
      const ground = String(formData.get("ground") ?? "");
      if (!isPmGround(ground)) return { error: "Choose the ground the landlord is ending it on." };
      tenancyUpdate.termination_ground = ground;
    }
  }
  if (move.asks === "managementEnded") {
    const reason = String(formData.get("reason") ?? "");
    if (!isPmManagementEndedReason(reason)) return { error: "Choose why the management has ended." };
    propertyUpdate.management_ended_on = eventDate;
    propertyUpdate.management_ended_reason = reason;
  }

  const tenancyId = await ensureTenancyId(supabase, loaded);
  if (!tenancyId) return { error: "Couldn't save that. Try again." };

  // Moved only if it is still where the page saw it. This goes first, so a
  // move that loses a race with someone else's writes nothing at all.
  const { data: moved, error } = await supabase
    .from("pm_properties")
    .update(propertyUpdate)
    .eq("id", propertyId)
    .eq("grp", move.from)
    .select("id");
  if (error) return { error: "Couldn't save that. Try again." };
  if (!moved || moved.length === 0) {
    return { error: "This property has moved on since the page loaded. Refresh to see where it is now." };
  }

  if (Object.keys(tenancyUpdate).length > 0) {
    const { error: tenancyUpdateError } = await supabase.from("pm_tenancies").update(tenancyUpdate).eq("id", tenancyId);
    if (tenancyUpdateError) {
      // Put the property back where it was rather than leave it moved without its dates.
      await supabase
        .from("pm_properties")
        .update({
          grp: move.from,
          management_ended_on: loaded.property.management_ended_on ?? null,
          management_ended_reason: loaded.property.management_ended_reason ?? null,
        })
        .eq("id", propertyId)
        .eq("grp", move.to);
      return { error: "Couldn't save that. Try again." };
    }
  }

  // Re-leasing: the next tenant gets a new tenancy, never the old one written
  // over (brief B2). From here on an existing property runs like any other,
  // so nothing is "Before RealComply".
  let newTenancyId: string | null = null;
  if (move.newTenancy) {
    const nextSeq = Math.max(...loaded.tenancies.map((t) => t.seq), 0) + 1;
    const { data: created, error: tenancyError } = await supabase
      .from("pm_tenancies")
      .insert({ agency_id: loaded.property.agency_id, property_id: propertyId, seq: nextSeq, before_stages: [] })
      .select("id")
      .single();
    if (tenancyError || !created) {
      // Put it back where it was rather than leave it in For lease on the old tenancy.
      await supabase.from("pm_properties").update({ grp: move.from }).eq("id", propertyId);
      return { error: "Couldn't start the new tenancy. Try again." };
    }
    newTenancyId = created.id;
  }

  await supabase.from("pm_group_moves").insert({
    agency_id: loaded.property.agency_id,
    property_id: propertyId,
    tenancy_id: newTenancyId ?? tenancyId,
    from_grp: move.from,
    to_grp: move.to,
    event_date: eventDate,
  });

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}

/** "Tenant has moved out" on an outgoing tenancy, while the next one is being let (brief B2). */
export async function moveOutOutgoingTenant(
  propertyId: string,
  tenancyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };
  const out = pmOutgoing(loaded.input).find((o) => o.tenancyId === tenancyId);
  if (!out) return { error: "That tenancy has been filed under History." };
  if (out.movedOut) return { error: "That tenant has already moved out." };

  const date = String(formData.get("date") ?? "").trim();
  if (!isIsoDate(date)) return { error: "Enter the move-out date." };
  if (out.tenancy.moveInDate && date < out.tenancy.moveInDate) {
    return { error: "The move-out date can't be before the move-in date." };
  }

  const { data: updated, error } = await supabase
    .from("pm_tenancies")
    .update({ move_out_date: date })
    .eq("id", tenancyId)
    .eq("property_id", propertyId)
    .is("move_out_date", null)
    .select("id");
  if (error || !updated || updated.length === 0) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}

/**
 * The water usage questions (brief B5). Saved once the answers reach an end:
 * "No" to the first or second, or an answer to the third. The server works
 * out the state from the answers; the screen's view of it is not trusted.
 */
export async function setPmWater(propertyId: string, answers: unknown): Promise<ActionState> {
  const { supabase, user, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };
  const refusal = pmCanAnswerWater(loaded.input);
  if (refusal) return { error: refusal };

  const clean = pmWaterClean(answers);
  if (!clean) return { error: "Something went wrong. Try again." };
  const result = pmWaterResult(clean);
  if (result.next !== null) return { error: "Answer the next question first." };

  const tenancyId = await ensureTenancyId(supabase, loaded);
  if (!tenancyId) return { error: "Couldn't save that. Try again." };

  const { data: row } = await supabase
    .from("pm_item_states")
    .select("id")
    .eq("tenancy_id", tenancyId)
    .eq("item_key", "water_usage")
    .maybeSingle();
  const { error } = row
    ? await supabase
        .from("pm_item_states")
        .update({ state: result.state, detail: clean, changed_by: user.id })
        .eq("id", row.id)
    : await supabase.from("pm_item_states").insert({
        agency_id: loaded.property.agency_id,
        property_id: propertyId,
        tenancy_id: tenancyId,
        item_key: "water_usage",
        state: result.state,
        detail: clean,
        changed_by: user.id,
      });
  if (error) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}

const RECORD_KINDS = new Set<string>([...PM_EVENT_RECORDS.map((r) => r.key), "pet_request", "pet_application"]);

/**
 * Record something that happened (brief B6, B7): a Stage 4 event (each press
 * records the person and the time), a pet request, or a pet on the
 * application. The database stamps who and when.
 */
export async function addPmRecord(propertyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const kind = String(formData.get("kind") ?? "");
  if (!RECORD_KINDS.has(kind)) return { error: "Something went wrong. Try again." };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };
  const refusal = pmCanRecord(loaded.input, kind === "pet_application" ? "pet_application" : "ongoing");
  if (refusal) return { error: refusal };

  let data: Record<string, string | null> = {};
  if (kind === "pet_request" || kind === "pet_application") {
    const spec = kind === "pet_request" ? PM_PET_REQUEST : PM_PET_APPLICATION;
    const outcome = String(formData.get("outcome") ?? "");
    if (!spec.outcomes.some((o) => o.key === outcome)) return { error: "Choose the outcome." };
    let ground: string | null = null;
    if (outcome === spec.refusedKey) {
      ground = String(formData.get("ground") ?? "");
      if (!isPmPetGround(ground)) return { error: "Choose the ground relied on." };
    }
    data = { outcome, ground };
    if (kind === "pet_request") {
      const received = String(formData.get("received") ?? "").trim();
      if (!isIsoDate(received)) return { error: "Enter the date the request was received." };
      data.received = received;
    }
  }

  const tenancyId = await ensureTenancyId(supabase, loaded);
  if (!tenancyId) return { error: "Couldn't save that. Try again." };

  const { error } = await supabase.from("pm_records").insert({
    agency_id: loaded.property.agency_id,
    property_id: propertyId,
    tenancy_id: tenancyId,
    kind,
    data,
  });
  if (error) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  return { error: null };
}

/** "Response given" on a pet request. Stops the 21-day deadline showing. Stamped by the database. */
export async function markPetResponseGiven(propertyId: string, recordId: string): Promise<ActionState> {
  const { supabase, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  // Allowed after move-out and while the next tenancy is let, so the 21-day
  // deadline can always be cleared (brief B6). Not once the management has ended.
  const { data: property } = await supabase.from("pm_properties").select("grp").eq("id", propertyId).maybeSingle();
  if (!property) return { error: "That property could not be found." };
  if (property.grp === "archived") return { error: "This management has ended." };

  const { data: updated, error } = await supabase
    .from("pm_records")
    .update({ response_given_at: new Date().toISOString() })
    .eq("id", recordId)
    .eq("property_id", propertyId)
    .eq("kind", "pet_request")
    .is("response_given_at", null)
    .select("id");
  if (error || !updated || updated.length === 0) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/pm/${propertyId}`);
  return { error: null };
}
