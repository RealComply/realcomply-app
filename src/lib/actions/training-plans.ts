"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { currentCpdYear } from "@/lib/cpd-year";
import { cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import type { CpdPracticeCategory, LicenceType, TrainingPlan, TrainingPlanItem } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

function num(formData: FormData, key: string): number | null {
  const s = str(formData, key);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const PATHS = ["/dashboard/training", "/dashboard/registers"];
function revalidate() {
  for (const p of PATHS) revalidatePath(p);
}

/**
 * Creates this CPD year's plan for a person.
 *
 * The requirement is SNAPSHOT onto the plan at creation, not looked up when
 * the plan is displayed. Fair Trading republishes the CPD ruleset annually on
 * an unversioned page, and it changed materially this year — so a plan built
 * in August against 7 hours must keep saying 7 hours after the page moves,
 * or the signed document stops matching what was signed.
 *
 * Where Fair Trading has published nothing, the snapshot is null and the note
 * carries the reason. That is deliberate: a plan that says "requirement not
 * published" is honest, and a plan that says "7" when nobody published 7 is
 * the defect this whole exercise exists to remove.
 */
export async function createTrainingPlan(profileId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can start a plan for someone else." };
  }

  const { data: subjectRow } = await supabase
    .from("profiles")
    .select("licence_type, cpd_practice_category, agency_id")
    .eq("id", profileId)
    .maybeSingle();

  const subject = subjectRow as
    | { licence_type: LicenceType | null; cpd_practice_category: CpdPracticeCategory | null; agency_id: string }
    | null;
  if (!subject) return { error: "Couldn't find that team member." };

  const year = currentCpdYear();
  const requirement = cpdRequirementFor(subject.licence_type, subject.cpd_practice_category);

  const { error } = await supabase.from("training_plans").insert({
    agency_id: subject.agency_id,
    profile_id: profileId,
    cpd_year_start: year.start,
    valid_from: year.start,
    valid_to: year.end,
    required_hours: requirement.coreHours,
    required_units: requirement.units,
    requirement_note: requirement.unpublished.length > 0 ? requirement.unpublished.join(" ") : null,
    created_by: profile.id,
  });

  if (error) {
    // The unique index on (profile_id, cpd_year_start) is the likely cause —
    // two people opening the page at once, or a double submit.
    return { error: "There's already a plan for this CPD year. Open it rather than starting another." };
  }

  revalidate();
  return ok;
}

/** Step 1–2 of the REINSW process: the consultation and what it found. */
export async function saveTrainingPlanConsultation(
  planId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const plan = await loadPlan(supabase, planId);
  if (!plan) return { error: "Couldn't find that plan." };
  if (plan.profile_id !== profile.id && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can edit someone else's plan." };
  }
  if (plan.principal_signed_at) {
    return { error: "This plan has been approved. Reopen it before changing the consultation notes." };
  }

  const { error } = await supabase
    .from("training_plans")
    .update({
      consultation_date: str(formData, "consultationDate"),
      identified_gaps: str(formData, "identifiedGaps"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);

  if (error) return { error: "Couldn't save — try again." };
  revalidate();
  return ok;
}

export async function addTrainingPlanItem(planId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const plan = await loadPlan(supabase, planId);
  if (!plan) return { error: "Couldn't find that plan." };
  if (plan.profile_id !== profile.id && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can add training to someone else's plan." };
  }
  if (plan.principal_signed_at) {
    return { error: "This plan has been approved. Reopen it before adding training." };
  }

  const programName = str(formData, "programName");
  if (!programName) return { error: "Give the training program a name." };

  // The gap is the point. A plan is a set of programs each tied to something
  // the consultation identified — without it this is a course list, which is
  // what Requirement 2.4 is asking for more than.
  const gapReason = str(formData, "gapReason");
  if (!gapReason) return { error: "Note the gap this training addresses — that's what makes it a plan." };

  const { count } = await supabase
    .from("training_plan_items")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);

  const { error } = await supabase.from("training_plan_items").insert({
    agency_id: plan.agency_id,
    plan_id: planId,
    program_name: programName,
    classification: str(formData, "classification") ?? "compulsory",
    delivery_type: str(formData, "deliveryType"),
    training_hours: num(formData, "trainingHours"),
    provider: str(formData, "provider"),
    gap_reason: gapReason,
    due_date: str(formData, "dueDate"),
    sort_order: count ?? 0,
  });

  if (error) return { error: "Couldn't add that training — try again." };
  revalidate();
  return ok;
}

/**
 * Marks a plan item complete and writes the matching CPD record in one step.
 *
 * Doing both together is the whole reason the plan is worth having in
 * software rather than in Word: the plan says what should happen, the CPD
 * register says what did, and keeping them in sync by hand is exactly the
 * job nobody does in June.
 *
 * Assistant agents are counted in units, not hours, so a unit lands as 1 in
 * the shared `hours` column under the assistant_unit category — the same
 * convention 0004_registers.sql already established.
 */
export async function completeTrainingPlanItem(
  itemId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: itemRow } = await supabase.from("training_plan_items").select("*").eq("id", itemId).maybeSingle();
  const item = itemRow as TrainingPlanItem | null;
  if (!item) return { error: "Couldn't find that training." };

  const plan = await loadPlan(supabase, item.plan_id);
  if (!plan) return { error: "Couldn't find that plan." };
  if (plan.profile_id !== profile.id && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can complete training on someone else's plan." };
  }

  const completedDate = str(formData, "completedDate");
  if (!completedDate) return { error: "Enter the date the training was completed." };

  const { data: subjectRow } = await supabase
    .from("profiles")
    .select("licence_type")
    .eq("id", plan.profile_id)
    .maybeSingle();
  const isAssistant = (subjectRow as { licence_type: LicenceType | null } | null)?.licence_type === "certificate_of_registration";

  // Write the CPD record first: if this fails we don't want an item marked
  // complete with nothing behind it in the register.
  const { data: cpdRow, error: cpdError } = await supabase
    .from("cpd_records")
    .insert({
      agency_id: plan.agency_id,
      profile_id: plan.profile_id,
      activity_name: item.program_name,
      category: isAssistant ? "assistant_unit" : "general",
      hours: isAssistant ? 1 : (item.training_hours ?? 0),
      completed_date: completedDate,
      notes: item.provider ? `From the ${plan.cpd_year_start.slice(0, 4)} training plan — ${item.provider}` : "From the annual training plan",
      created_by: profile.id,
    })
    .select("id")
    .maybeSingle();

  if (cpdError) return { error: "Couldn't record the CPD — try again." };

  const { error } = await supabase
    .from("training_plan_items")
    .update({ completed_date: completedDate, cpd_record_id: (cpdRow as { id: string } | null)?.id ?? null })
    .eq("id", itemId);

  if (error) return { error: "Recorded the CPD but couldn't tick the plan item — try again." };

  revalidate();
  return ok;
}

export async function deleteTrainingPlanItem(itemId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  const { data: itemRow } = await supabase.from("training_plan_items").select("plan_id").eq("id", itemId).maybeSingle();
  const planId = (itemRow as { plan_id: string } | null)?.plan_id;
  if (!planId) return;

  const plan = await loadPlan(supabase, planId);
  if (!plan) return;
  if (plan.profile_id !== profile.id && !profile.is_licensee_in_charge) return;
  if (plan.principal_signed_at) return;

  await supabase.from("training_plan_items").delete().eq("id", itemId);
  revalidate();
}

/**
 * The two-party sign-off.
 *
 * The staff member accepts; the licensee in charge approves. Neither can do
 * the other's, and neither is auto-filled — a plan the staff member never saw
 * is not "developed in consultation with" them, which is what Requirement 2.4
 * actually asks for. Same typed-signature model as the per-file sign-offs.
 */
export async function signTrainingPlan(
  planId: string,
  side: "staff" | "principal",
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const plan = await loadPlan(supabase, planId);
  if (!plan) return { error: "Couldn't find that plan." };

  const typedName = str(formData, "typedName");
  if (!typedName) return { error: "Type your name to sign." };

  if (side === "staff") {
    if (plan.profile_id !== profile.id) {
      return { error: "Only the person this plan is for can accept it." };
    }
  } else {
    if (!profile.is_licensee_in_charge) {
      return { error: "Only the licensee in charge can approve a training plan." };
    }
    if (!plan.staff_signed_at) {
      return { error: "The staff member needs to accept the plan before you approve it." };
    }
  }

  const now = new Date().toISOString();
  const patch =
    side === "staff"
      ? { staff_signed_name: typedName, staff_signed_at: now }
      : { principal_signed_name: typedName, principal_signed_at: now };

  const { error } = await supabase.from("training_plans").update({ ...patch, updated_at: now }).eq("id", planId);
  if (error) return { error: "Couldn't record the signature — try again." };

  revalidate();
  return ok;
}

/** Reopens an approved plan so it can be revised — Requirement 2.4 expects review. */
export async function reopenTrainingPlan(planId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;

  await supabase
    .from("training_plans")
    .update({
      principal_signed_name: null,
      principal_signed_at: null,
      staff_signed_name: null,
      staff_signed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId);

  revalidate();
}

/** Records the category of practice a person's CPD hours are measured against. */
export async function updateCpdPracticeCategory(
  profileId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change someone else's category." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ cpd_practice_category: str(formData, "cpdPracticeCategory") })
    .eq("id", profileId);

  if (error) return { error: "Couldn't save — try again." };
  revalidate();
  return ok;
}

type SupabaseClient = Awaited<ReturnType<typeof requireAuthContext>>["supabase"];

async function loadPlan(supabase: SupabaseClient, planId: string): Promise<TrainingPlan | null> {
  const { data } = await supabase.from("training_plans").select("*").eq("id", planId).maybeSingle();
  return (data as TrainingPlan | null) ?? null;
}
