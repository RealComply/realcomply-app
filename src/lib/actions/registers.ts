"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { LicenceType } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// ── Licence details (per-person, lives on profiles) ────────────────────────
// Anyone can maintain their own licence record; the licensee can also fix a
// colleague's — same self-or-licensee pattern used for licenseeOnly items,
// just not gated to "licensee only" outright since a licence is the holder's
// own credential, not something only the LIC attests to.
export async function updateLicence(profileId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can update someone else's licence details." };
  }

  const licenceType = str(formData, "licenceType") as LicenceType | null;
  const licenceNumber = str(formData, "licenceNumber");
  const licenceExpiry = str(formData, "licenceExpiry");

  const { error } = await supabase
    .from("profiles")
    .update({
      licence_type: licenceType,
      licence_number: licenceNumber,
      licence_expiry: licenceExpiry,
    })
    .eq("id", profileId);

  if (error) return { error: "Couldn't save licence details — try again." };

  revalidatePath("/dashboard/registers");
  return ok;
}

// ── PI insurance (agency-level — s22 PSA Act, a condition of every licence
// in the agency, so this is the licensee's to maintain, not any one agent's) ─
export async function updatePiInsurance(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can update the agency's PI insurance details." };
  }

  const piInsurer = str(formData, "piInsurer");
  const piPolicyNumber = str(formData, "piPolicyNumber");
  const piExpiry = str(formData, "piExpiry");

  const { error } = await supabase
    .from("agencies")
    .update({ pi_insurer: piInsurer, pi_policy_number: piPolicyNumber, pi_expiry: piExpiry })
    .eq("id", profile.agency_id);

  if (error) return { error: "Couldn't save PI insurance details — try again." };

  revalidatePath("/dashboard/registers");
  return ok;
}

// ── CPD records — manual entry (an external course, a Fair Trading forum,
// AUSTRAC AML training) alongside whatever recordAttendance auto-logs from
// CPD-eligible training sessions. ──────────────────────────────────────────
export async function addCpdRecord(profileId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can log CPD for someone else." };
  }

  const activityName = str(formData, "activityName");
  const category = str(formData, "category") ?? "general";
  const hoursRaw = str(formData, "hours");
  const completedDate = str(formData, "completedDate");
  const notes = str(formData, "notes");

  if (!activityName) return { error: "Give the activity a name." };
  const hours = hoursRaw ? Number(hoursRaw) : NaN;
  if (!Number.isFinite(hours) || hours <= 0) return { error: "Enter the hours (or units) as a positive number." };
  if (!completedDate) return { error: "Enter the date it was completed." };

  const { error } = await supabase.from("cpd_records").insert({
    agency_id: profile.agency_id,
    profile_id: profileId,
    activity_name: activityName,
    category,
    hours,
    completed_date: completedDate,
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that CPD record — try again." };

  revalidatePath("/dashboard/registers");
  return ok;
}

export async function deleteCpdRecord(recordId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();

  const { data: record } = await supabase
    .from("cpd_records")
    .select("profile_id")
    .eq("id", recordId)
    .maybeSingle();

  if (!record) return;
  const owned = (record as { profile_id: string }).profile_id === profile.id;
  if (!owned && !profile.is_licensee_in_charge) return;

  await supabase.from("cpd_records").delete().eq("id", recordId);
  revalidatePath("/dashboard/registers");
}

// ── Training sessions — the office training log (s32: outcome-based, no
// prescribed cadence; the agency sets and evidences its own). Any agency
// member can log one, same trust model as the rest of this app. ───────────
export async function addTrainingSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const title = str(formData, "title");
  const sessionDate = str(formData, "sessionDate");
  const isCpdEligible = formData.get("isCpdEligible") === "on";
  const cpdHoursRaw = str(formData, "cpdHours");
  const trainerName = str(formData, "trainerName");
  const isExternal = formData.get("isExternal") === "on";
  const notes = str(formData, "notes");

  if (!title) return { error: "Give the session a title." };
  if (!sessionDate) return { error: "Enter the session date." };

  let cpdHours: number | null = null;
  if (isCpdEligible) {
    cpdHours = cpdHoursRaw ? Number(cpdHoursRaw) : NaN;
    if (!Number.isFinite(cpdHours) || cpdHours <= 0) {
      return { error: "Enter how many CPD hours this session counts for." };
    }
  }

  const { error } = await supabase.from("training_sessions").insert({
    agency_id: profile.agency_id,
    title,
    session_date: sessionDate,
    is_cpd_eligible: isCpdEligible,
    cpd_hours: cpdHours,
    trainer_name: trainerName,
    is_external: isExternal,
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that session — try again." };

  revalidatePath("/dashboard/training");
  return ok;
}

export async function deleteTrainingSession(sessionId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;
  await supabase.from("training_sessions").delete().eq("id", sessionId);
  revalidatePath("/dashboard/training");
}

// Replaces attendance for a session with whatever's checked on the form, and
// keeps each attendee's auto-logged CPD record in sync: delete-then-reinsert
// both attendance and the linked cpd_records rows (source_session_id) so
// re-saving attendance is safe to run any number of times, never doubling up
// hours. Only fires the CPD write for sessions actually marked CPD-eligible.
export async function recordAttendance(sessionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: sessionRow } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow) return { error: "Session not found." };
  const session = sessionRow as {
    id: string;
    agency_id: string;
    title: string;
    session_date: string;
    is_cpd_eligible: boolean;
    cpd_hours: number | null;
  };

  const attendeeIds = formData.getAll("attendee").filter((v): v is string => typeof v === "string");

  await supabase.from("training_attendance").delete().eq("session_id", sessionId);
  await supabase.from("cpd_records").delete().eq("source_session_id", sessionId);

  if (attendeeIds.length > 0) {
    const { error: attendanceError } = await supabase.from("training_attendance").insert(
      attendeeIds.map((profileId) => ({
        agency_id: session.agency_id,
        session_id: sessionId,
        profile_id: profileId,
      })),
    );
    if (attendanceError) return { error: "Couldn't save attendance — try again." };

    if (session.is_cpd_eligible && session.cpd_hours) {
      const { error: cpdError } = await supabase.from("cpd_records").insert(
        attendeeIds.map((profileId) => ({
          agency_id: session.agency_id,
          profile_id: profileId,
          activity_name: session.title,
          category: "general",
          hours: session.cpd_hours,
          completed_date: session.session_date,
          source_session_id: sessionId,
          created_by: profile.id,
        })),
      );
      if (cpdError) return { error: "Attendance saved, but couldn't auto-log CPD hours — add them manually." };
    }
  }

  revalidatePath("/dashboard/training");
  revalidatePath("/dashboard/registers");
  return ok;
}
