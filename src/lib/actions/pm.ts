"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { ActionState } from "@/lib/actions/auth";
import { loadPmProperty, pmAgencySettings } from "@/lib/data/pm";
import { isPmOrigin, pmGroupLabel, pmItemStage, pmOrigin } from "@/lib/rules/nsw-pm";
import { pmBlockedLine, pmCanSetItem, pmMoveCheck, type PmTickState } from "@/lib/rules/pm-engine";

// Server actions for property management (PM), Part A. Brief:
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
export async function setPmItem(propertyId: string, itemKey: string, next: PmTickState): Promise<ActionState> {
  const { supabase, user, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };
  if (next !== "done" && next !== "na" && next !== "open") return { error: "Something went wrong. Try again." };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };

  // The lock, on the server.
  const refusal = pmCanSetItem(loaded.input, itemKey, next);
  if (refusal) return { error: refusal };

  // Onboarding ticks belong to the property (done once); the rest to the tenancy.
  const isOnboarding = pmItemStage(itemKey)?.scope === "property";
  const tenancyId = isOnboarding ? null : await ensureTenancyId(supabase, loaded);
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

/** The one move button (brief A9): Put up for lease, Tenant has moved in, and so on. */
export async function movePmProperty(propertyId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, pmEnabled } = await requirePm();
  if (!pmEnabled) return { error: PM_OFF };

  const loaded = await loadPmProperty(supabase, propertyId);
  if (!loaded) return { error: "That property could not be found." };

  const check = pmMoveCheck(loaded.input);
  if (!check) return { error: `There is nothing to move on to from ${pmGroupLabel(loaded.property.grp)} yet.` };
  // Someone else may have moved it since the page was drawn.
  if (String(formData.get("from") ?? "") !== check.move.from) {
    return { error: "This property has moved on since the page loaded. Refresh to see where it is now." };
  }
  if (check.blockedBy.length > 0) return { error: pmBlockedLine(check.blockedBy) };

  let eventDate: string | null = null;
  if (check.move.date) {
    eventDate = String(formData.get("date") ?? "").trim();
    if (!isIsoDate(eventDate)) return { error: `Enter the ${check.move.date.label.toLowerCase()}.` };
    const moveIn = loaded.tenancy?.move_in_date;
    if (check.move.date.field === "move_out_date" && moveIn && eventDate < moveIn) {
      return { error: "The move-out date can't be before the move-in date." };
    }
  }

  const tenancyId = await ensureTenancyId(supabase, loaded);
  if (!tenancyId) return { error: "Couldn't save that. Try again." };

  if (check.move.date && eventDate) {
    const { error } = await supabase
      .from("pm_tenancies")
      .update({ [check.move.date.field]: eventDate })
      .eq("id", tenancyId);
    if (error) return { error: "Couldn't save that. Try again." };
  }

  const { data: moved, error } = await supabase
    .from("pm_properties")
    .update({ grp: check.move.to })
    .eq("id", propertyId)
    .eq("grp", check.move.from)
    .select("id");
  if (error) return { error: "Couldn't save that. Try again." };
  if (!moved || moved.length === 0) {
    return { error: "This property has moved on since the page loaded. Refresh to see where it is now." };
  }

  await supabase.from("pm_group_moves").insert({
    agency_id: loaded.property.agency_id,
    property_id: propertyId,
    tenancy_id: tenancyId,
    from_grp: check.move.from,
    to_grp: check.move.to,
    event_date: eventDate,
  });

  revalidatePath(`/dashboard/pm/${propertyId}`);
  revalidatePath("/dashboard/pm");
  return { error: null };
}
