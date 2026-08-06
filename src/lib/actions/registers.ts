"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { GiftDirection, LicenceType } from "@/lib/types";

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

// ── Licence document (evidence for the licence register, same pattern as
// property evidence — upload happens client-side, this just records the
// path — see buildLicenceDocPath in storage/evidence.ts). ─────────────────
export async function finalizeLicenceDocument(
  profileId: string,
  path: string,
  fileName: string,
): Promise<{ error: string | null }> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can attach someone else's licence document." };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("licence_document_path")
    .eq("id", profileId)
    .maybeSingle();

  if (existing?.licence_document_path && existing.licence_document_path !== path) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existing.licence_document_path]);
  }

  const { error } = await supabase
    .from("profiles")
    .update({ licence_document_path: path, licence_document_file_name: fileName })
    .eq("id", profileId);

  revalidatePath("/dashboard/registers");
  return { error: error ? "Couldn't save the document — try again." : null };
}

export async function removeLicenceDocument(profileId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (profile.id !== profileId && !profile.is_licensee_in_charge) return;

  const { data: existing } = await supabase
    .from("profiles")
    .select("licence_document_path")
    .eq("id", profileId)
    .maybeSingle();

  if (existing?.licence_document_path) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existing.licence_document_path]);
  }

  await supabase
    .from("profiles")
    .update({ licence_document_path: null, licence_document_file_name: null })
    .eq("id", profileId);

  revalidatePath("/dashboard/registers");
}

// ── Gifts & benefits register — Rules of Conduct probity/conflicts control.
// Anything over the agency's threshold is auto-flagged for licensee review,
// same "flag, don't silently pass" principle as the rest of the app. ──────
export async function addGift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("gift_threshold")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const threshold = (agencyRow as { gift_threshold: number } | null)?.gift_threshold ?? 150;

  const giftDate = str(formData, "giftDate");
  const description = str(formData, "description");
  const counterparty = str(formData, "counterparty");
  const valueRaw = str(formData, "value");
  const direction = (str(formData, "direction") ?? "received") as GiftDirection;
  const agentId = str(formData, "profileId") ?? profile.id;
  const notes = str(formData, "notes");

  if (!giftDate) return { error: "Enter the date." };
  if (!description) return { error: "Describe the gift or benefit." };
  const value = valueRaw ? Number(valueRaw) : null;
  if (valueRaw && !Number.isFinite(value)) return { error: "Enter the value as a number." };

  const status = value !== null && value > threshold ? "flagged" : "recorded";

  const { error } = await supabase.from("gifts").insert({
    agency_id: profile.agency_id,
    profile_id: agentId,
    gift_date: giftDate,
    description,
    counterparty,
    value,
    direction,
    status,
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that entry — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

// Clears a flagged entry once the licensee has looked at it — the entry
// itself is never hidden or deleted, just marked reviewed (same "record the
// diligence, don't scrub the record" principle as everywhere else).
export async function markGiftReviewed(giftId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;
  await supabase.from("gifts").update({ status: "reviewed" }).eq("id", giftId).eq("status", "flagged");
  revalidatePath("/dashboard/registers");
}

export async function deleteGift(giftId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;
  await supabase.from("gifts").delete().eq("id", giftId);
  revalidatePath("/dashboard/registers");
}

export async function updateGiftThreshold(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return { error: "Only the licensee in charge can change the threshold." };

  const thresholdRaw = str(formData, "giftThreshold");
  const threshold = thresholdRaw ? Number(thresholdRaw) : NaN;
  if (!Number.isFinite(threshold) || threshold < 0) return { error: "Enter a valid dollar amount." };

  const { error } = await supabase.from("agencies").update({ gift_threshold: threshold }).eq("id", profile.agency_id);
  if (error) return { error: "Couldn't save the threshold — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

// ── Complaints register — tracked to resolution, optionally cross-linked to
// a property file. ─────────────────────────────────────────────────────────
export async function addComplaint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const receivedDate = str(formData, "receivedDate");
  const complainant = str(formData, "complainant");
  const nature = str(formData, "nature");
  const agentId = str(formData, "agentId");
  const propertyId = str(formData, "propertyId");
  const notes = str(formData, "notes");

  if (!receivedDate) return { error: "Enter the date received." };
  if (!complainant) return { error: "Enter who the complaint is from." };
  if (!nature) return { error: "Describe the complaint." };

  const { error } = await supabase.from("complaints").insert({
    agency_id: profile.agency_id,
    received_date: receivedDate,
    complainant,
    nature,
    agent_id: agentId,
    property_id: propertyId,
    status: "open",
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that complaint — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

export async function updateComplaintStatus(
  complaintId: string,
  status: "open" | "under_review" | "resolved",
): Promise<void> {
  const { supabase } = await requireAuthContext();
  await supabase
    .from("complaints")
    .update({
      status,
      resolved_date: status === "resolved" ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", complaintId);
  revalidatePath("/dashboard/registers");
}

export async function deleteComplaint(complaintId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;
  await supabase.from("complaints").delete().eq("id", complaintId);
  revalidatePath("/dashboard/registers");
}

// ── SG Manual — simple upload + version history. Current version is just
// the most recent row; older ones stay on file for the audit trail. ───────
export async function addSgManualVersion(
  path: string,
  fileName: string,
  versionLabel: string | null,
  notes: string | null = null,
): Promise<{ error: string | null }> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can publish a new SG Manual version." };
  }

  const { error } = await supabase.from("sg_manual_versions").insert({
    agency_id: profile.agency_id,
    version_label: versionLabel,
    file_path: path,
    file_name: fileName,
    notes,
    uploaded_by: profile.id,
  });

  revalidatePath("/dashboard/sg-manual");
  return { error: error ? "Couldn't save that version — try again." : null };
}
