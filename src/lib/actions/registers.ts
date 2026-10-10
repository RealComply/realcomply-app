"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { createSignoffDocument } from "@/lib/actions/signoffs";
import { validIsoDate } from "@/lib/licence-read";
import { attendanceChanges } from "@/lib/attendance-changes";
import { cpdFolder, isInFolder, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { BreachCategory, BreachSeverity, GiftDirection, InsurancePolicyType } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// Licence and certificate records (people's and the corporation licence) live
// in actions/licences.ts, alongside the document read and their history.

// ── Insurance register (agency-level policies — PI insurance is a condition
// of every licence in the agency under s22 PSA Act; cyber and iCare workers
// insurance aren't PSA Act requirements but sit alongside it as the same
// kind of agency-level "policy on file, tracked to expiry" record, so they
// share one action and one card component rather than three near-identical
// copies. All three are the licensee's to maintain, not any one agent's.) ──
const POLICY_COLUMNS: Record<InsurancePolicyType, { insurer: string; policyNumber: string; expiry: string }> = {
  pi: { insurer: "pi_insurer", policyNumber: "pi_policy_number", expiry: "pi_expiry" },
  cyber: { insurer: "cyber_insurer", policyNumber: "cyber_policy_number", expiry: "cyber_expiry" },
  icare: { insurer: "icare_insurer", policyNumber: "icare_policy_number", expiry: "icare_expiry" },
};

export async function updateInsurancePolicy(
  policyType: InsurancePolicyType,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();

  // access, not the raw flag: the agent on their own plan is the licensee
  // for their account, and 0058 lets them write the agency row (10 Oct 2026).
  if (!access.actsAsLicensee) {
    return { error: "Only the licensee in charge can update the agency's insurance details." };
  }

  const columns = POLICY_COLUMNS[policyType];
  const insurer = str(formData, "insurer");
  const policyNumber = str(formData, "policyNumber");
  const expiry = str(formData, "expiry");

  const { error } = await supabase
    .from("agencies")
    .update({ [columns.insurer]: insurer, [columns.policyNumber]: policyNumber, [columns.expiry]: expiry })
    .eq("id", profile.agency_id);

  if (error) return { error: "Couldn't save insurance details — try again." };

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
  const provider = str(formData, "provider");

  if (!activityName) return { error: "Give the activity a name." };
  const hours = hoursRaw ? Number(hoursRaw) : NaN;
  if (!Number.isFinite(hours) || hours <= 0) return { error: "Enter the hours (or units) as a positive number." };
  if (!completedDate) return { error: "Enter the date it was completed." };
  // The provider is what makes this CPD rather than office training. Asked
  // for here rather than left optional, because an entry with nobody named
  // can't be shown to qualify — and the person filling this in months later
  // is the one who'd have to reconstruct it. See 0021/0022.
  if (!provider) {
    return {
      error:
        "Name the approved provider who delivered it. Only Fair Trading approved providers deliver CPD — for an assistant agent's unit, the RTO that issued the statement of attainment.",
    };
  }

  const { error } = await supabase.from("cpd_records").insert({
    agency_id: profile.agency_id,
    profile_id: profileId,
    activity_name: activityName,
    category,
    hours,
    completed_date: completedDate,
    provider,
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that CPD record — try again." };

  revalidatePath("/dashboard/registers");
  revalidatePath("/dashboard/cpd");
  return ok;
}

/**
 * The whole CPD flow, in one call: the agent uploads a certificate and this
 * creates the register entry from what the document says.
 *
 * Adam, 18 Aug 2026 — "upload that certificate and tick that the CPD's been
 * done for that year. All the information we need will be on the certificate.
 * Less friction, less manual data entry."
 *
 * The extracted values are written straight in rather than staged for review,
 * which is a deliberate departure from the confirm-before-save pattern used
 * for property documents. Two reasons it is safe here and not there: a record
 * of completion is a prescribed, highly structured document rather than a
 * free-form contract, and every field lands on a card the agent is looking at
 * with the source document one click away — so review happens, it just
 * happens after rather than before, and correcting a row is a smaller act
 * than filling in a form.
 *
 * Where the model reads nothing useful, the entry is still created against
 * the file with the filename as its title. An unreadable certificate is still
 * evidence; refusing to record it would lose the document to save face.
 */
export async function addCpdFromCertificate(
  profileId: string,
  path: string,
  fileName: string,
): Promise<{ error: string | null }> {
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can add CPD for someone else." };
  }
  // The browser says where it put the certificate; it must be that person's
  // CPD folder, since the licensee's delete later removes whatever file the
  // record names (review of these fixes, 10 Oct 2026).
  if (!isInFolder(path, cpdFolder(profile.agency_id, profileId))) {
    return { error: "Couldn't save that certificate — try again." };
  }

  const { extractCpdCertificate } = await import("@/lib/actions/extraction");
  const { fields } = await extractCpdCertificate(path, fileName);
  const f = fields ?? {};

  // Units and hours are stored in the same column (the convention set in
  // 0004_registers.sql), with the category telling them apart.
  const isUnit = typeof f.units === "number" && f.units > 0;
  const hours = isUnit ? f.units : typeof f.hours === "number" && f.hours > 0 ? f.hours : null;

  // Never guess (Oct 2026). A certificate that doesn't state its hours used to
  // be saved as 0 hours, and one with no readable date was dated today. Both
  // now stay empty (0051 made the columns nullable) and the CPD card asks for
  // just that field. An empty field counts as nothing toward the year.
  const completedDate = validIsoDate(f.completedDate);

  const { error } = await supabase.from("cpd_records").insert({
    agency_id: profile.agency_id,
    profile_id: profileId,
    activity_name: f.activityName?.trim() || fileName.replace(/\.[^.]+$/, ""),
    category: isUnit ? "assistant_unit" : "general",
    hours,
    completed_date: completedDate,
    provider: f.provider?.trim() || null,
    evidence_path: path,
    evidence_file_name: fileName,
    notes: f.deliveryMode ? `Delivery: ${f.deliveryMode}` : null,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that certificate — try again." };

  revalidatePath("/dashboard/cpd");
  return { error: null };
}

/** Corrects anything the reading got wrong. The document stays attached. */
export async function updateCpdRecord(recordId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: row } = await supabase.from("cpd_records").select("profile_id").eq("id", recordId).maybeSingle();
  const ownerId = (row as { profile_id: string } | null)?.profile_id;
  if (!ownerId) return { error: "Couldn't find that entry." };
  if (ownerId !== profile.id && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change someone else's CPD." };
  }

  const activityName = str(formData, "activityName");
  if (!activityName) return { error: "Give the activity a name." };

  // Blank stays blank: an empty hours field is "not stated", not zero.
  const hoursRaw = str(formData, "hours");
  const hours = hoursRaw ? Number(hoursRaw) : null;
  if (hours !== null && (!Number.isFinite(hours) || hours < 0)) return { error: "Hours must be a number." };

  const { error } = await supabase
    .from("cpd_records")
    .update({
      activity_name: activityName,
      provider: str(formData, "provider"),
      hours,
      completed_date: str(formData, "completedDate") ?? undefined,
    })
    .eq("id", recordId);

  if (error) return { error: "Couldn't save — try again." };
  revalidatePath("/dashboard/cpd");
  return ok;
}

/**
 * The year's tick. Un-ticking deletes the row rather than storing a false,
 * so there is never a record that reads like someone actively declared they
 * had NOT done their CPD — see 0023_cpd_year_signoff.sql.
 */
export async function setCpdYearComplete(
  profileId: string,
  cpdYearStart: string,
  complete: boolean,
): Promise<{ error: string | null }> {
  const { supabase, profile, access } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can confirm this for someone else." };
  }

  if (!complete) {
    // Un-ticking a year removes its sign-off record, and only the licensee
    // deletes compliance records (Adam, 9 Oct 2026).
    if (!access.actsAsLicensee) {
      return { error: "Only the licensee in charge can reopen a confirmed CPD year." };
    }
    await supabase
      .from("cpd_year_signoffs")
      .delete()
      .eq("profile_id", profileId)
      .eq("cpd_year_start", cpdYearStart);
    revalidatePath("/dashboard/cpd");
    return { error: null };
  }

  const { error } = await supabase.from("cpd_year_signoffs").insert({
    agency_id: profile.agency_id,
    profile_id: profileId,
    cpd_year_start: cpdYearStart,
    confirmed_by: profile.id,
  });

  // Unique on (profile, year) — a double-click is a success, not a failure.
  if (error && !String(error.message).includes("duplicate")) {
    return { error: "Couldn't save that — try again." };
  }

  revalidatePath("/dashboard/cpd");
  return { error: null };
}

// Records where the provider's certificate landed in Storage. Same
// upload-then-record-path pattern as licence documents — a Server Action
// can't carry the file itself, so the browser uploads and this saves the
// pointer. Adam, 18 Aug 2026: "upload the CPD certificate and tick it off
// against each staff member."
export async function finalizeCpdEvidence(recordId: string, path: string, fileName: string): Promise<{ error: string | null }> {
  const { supabase, profile } = await requireAuthContext();

  const { data: row } = await supabase.from("cpd_records").select("profile_id, agency_id").eq("id", recordId).maybeSingle();
  const ownerId = (row as { profile_id: string } | null)?.profile_id;
  if (!ownerId) return { error: "Couldn't find that CPD record." };
  if (ownerId !== profile.id && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can attach a certificate for someone else." };
  }
  // Only a file in that person's CPD folder (see addCpdFromCertificate).
  if (!isInFolder(path, cpdFolder((row as { agency_id: string }).agency_id, ownerId))) {
    return { error: "Couldn't save the certificate — try again." };
  }

  const { error } = await supabase
    .from("cpd_records")
    .update({ evidence_path: path, evidence_file_name: fileName })
    .eq("id", recordId);

  if (error) return { error: "Couldn't save the certificate — try again." };

  revalidatePath("/dashboard/cpd");
  return { error: null };
}

export async function removeCpdEvidence(recordId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  const { data: row } = await supabase.from("cpd_records").select("profile_id").eq("id", recordId).maybeSingle();
  const ownerId = (row as { profile_id: string } | null)?.profile_id;
  if (!ownerId) return;
  if (ownerId !== profile.id && !profile.is_licensee_in_charge) return;

  await supabase.from("cpd_records").update({ evidence_path: null, evidence_file_name: null }).eq("id", recordId);
  revalidatePath("/dashboard/cpd");
}

export async function deleteCpdRecord(recordId: string): Promise<void> {
  const { supabase, access } = await requireAuthContext();

  const { data: record } = await supabase
    .from("cpd_records")
    .select("profile_id, agency_id, evidence_path")
    .eq("id", recordId)
    .maybeSingle();

  if (!record) return;
  // REVERSAL (Adam, 9 Oct 2026): was the owner or the licensee; now only the
  // licensee deletes a compliance record, and the delete is logged (0058).
  if (!access.actsAsLicensee) return;

  const { data: deleted } = await supabase.from("cpd_records").delete().eq("id", recordId).select("id");
  // The certificate goes with its record (check, 10 Oct 2026). It was left in
  // {agency}/_cpd/{person}/ with nothing pointing at it and no control that
  // could remove it. Only once the record has actually gone, and on the
  // licensee's own access, the one person who may delete files (0058); that
  // delete is logged too.
  //
  // Only a file in that person's CPD folder: the record's path is written by
  // whoever may change the record, and this removes it with the licensee's
  // access (review of these fixes, 10 Oct 2026).
  const { evidence_path: evidencePath, agency_id: agencyId, profile_id: profileId } = record as {
    evidence_path: string | null;
    agency_id: string;
    profile_id: string;
  };
  if (deleted && deleted.length > 0 && evidencePath && isInFolder(evidencePath, cpdFolder(agencyId, profileId))) {
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([evidencePath]);
    // The folder only, never the file name.
    if (error) console.error("CPD certificate not deleted:", evidencePath.split("/").slice(0, 3).join("/"), error.message);
  }
  revalidatePath("/dashboard/registers");
}

// ── Training sessions — the office training log (s32: outcome-based, no
// prescribed cadence; the agency sets and evidences its own). The licensee
// runs the office's training log (Adam, 7 Oct 2026; was any member). ───────
export async function addTrainingSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can add to the training log." };

  const title = str(formData, "title");
  const sessionDate = str(formData, "sessionDate");
  const isCpdEligible = formData.get("isCpdEligible") === "on";
  const cpdHoursRaw = str(formData, "cpdHours");
  const trainerName = str(formData, "trainerName");
  const isExternal = formData.get("isExternal") === "on";
  const notes = str(formData, "notes");

  if (!title) return { error: "Give the session a title." };
  if (!sessionDate) return { error: "Enter the session date." };

  const cpdProvider = str(formData, "cpdProvider");

  let cpdHours: number | null = null;
  if (isCpdEligible) {
    cpdHours = cpdHoursRaw ? Number(cpdHoursRaw) : NaN;
    if (!Number.isFinite(cpdHours) || cpdHours <= 0) {
      return { error: "Enter how many CPD hours this session counts for." };
    }
    // NSW CPD can only be delivered by a Fair Trading approved provider, and
    // every published hour for 2026–27 is a compulsory topic. Your own
    // internal training has no provider behind it and earns nothing, so the
    // name is the thing that decides whether this is CPD at all.
    if (!cpdProvider) {
      return {
        error:
          "Name the approved provider who delivered it. Only Fair Trading approved providers can deliver CPD — an internal session doesn't count, wherever it was held.",
      };
    }
  }

  const { error } = await supabase.from("training_sessions").insert({
    agency_id: profile.agency_id,
    title,
    session_date: sessionDate,
    is_cpd_eligible: isCpdEligible,
    cpd_hours: cpdHours,
    cpd_provider: isCpdEligible ? cpdProvider : null,
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
  // access, not the raw flag, like adding a session and recording attendance:
  // the agent on their own plan saw Delete and it did nothing (check, 10 Oct 2026).
  const { supabase, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  await supabase.from("training_sessions").delete().eq("id", sessionId);
  revalidatePath("/dashboard/training");
}

// Makes attendance for a session match whatever's checked on the form, and
// keeps each attendee's auto-logged CPD record (source_session_id) in step,
// so re-saving attendance is safe to run any number of times, never doubling
// up hours. Only fires the CPD write for sessions actually marked CPD-eligible.
//
// Changes only what changed (check, 10 Oct 2026; was delete-everything-then-
// reinsert, which since 0058 logged every attendee's records as deleted on
// each save and undid their corrections). See lib/attendance-changes.ts.
export async function recordAttendance(sessionId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  // Rewriting attendance replaces other people's session CPD records, so it
  // is the licensee's alone (Adam, 7 and 9 Oct 2026; was any member).
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can record attendance." };

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
    cpd_provider: string | null;
  };

  const attendeeIds = formData.getAll("attendee").filter((v): v is string => typeof v === "string");

  const [{ data: attendanceRows, error: readError }, { data: cpdRows, error: cpdReadError }] = await Promise.all([
    supabase.from("training_attendance").select("profile_id").eq("session_id", sessionId),
    supabase.from("cpd_records").select("profile_id").eq("source_session_id", sessionId),
  ]);
  if (readError || cpdReadError) return { error: "Couldn't save attendance — try again." };

  const { unticked, ticked, needCpd } = attendanceChanges({
    recorded: ((attendanceRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id),
    withCpd: ((cpdRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id),
    wanted: attendeeIds,
  });

  // From here on, every return refreshes the page first, a refusal included
  // (review of 10 Oct 2026). The ticks start from the attendance on record,
  // and the editor stays open on a message. When the CPD write failed after
  // a latecomer's attendance was saved, the page still showed the old
  // attendance, the latecomer's box went back to empty, and saving again
  // "mended" it by removing them.
  const settle = (result: ActionState): ActionState => {
    revalidatePath("/dashboard/training");
    revalidatePath("/dashboard/registers");
    return result;
  };

  if (unticked.length > 0) {
    await supabase.from("training_attendance").delete().eq("session_id", sessionId).in("profile_id", unticked);
    await supabase.from("cpd_records").delete().eq("source_session_id", sessionId).in("profile_id", unticked);
  }

  if (ticked.length > 0) {
    const { error: attendanceError } = await supabase.from("training_attendance").insert(
      ticked.map((profileId) => ({
        agency_id: session.agency_id,
        session_id: sessionId,
        profile_id: profileId,
      })),
    );
    if (attendanceError) return settle({ error: "Couldn't save attendance — try again." });
  }

  // The provider is the gate, not the tick-box. NSW CPD can only be
  // delivered by a Fair Trading approved provider, and for 2026–27 every
  // published hour is a compulsory topic — there is no elective or
  // self-directed category to absorb an internal session. So a session with
  // no named provider records attendance and nothing else, however it was
  // ticked. (The venue is irrelevant: an approved provider delivering in
  // your own office does count, which is why this checks the provider
  // rather than is_external.)
  if (needCpd.length > 0 && session.is_cpd_eligible && session.cpd_hours && session.cpd_provider) {
    const { error: cpdError } = await supabase.from("cpd_records").insert(
      needCpd.map((profileId) => ({
        agency_id: session.agency_id,
        profile_id: profileId,
        activity_name: session.title,
        category: "general",
        hours: session.cpd_hours,
        completed_date: session.session_date,
        // Recorded in its own column so the record shows who delivered it.
        provider: session.cpd_provider,
        source_session_id: sessionId,
        created_by: profile.id,
      })),
    );
    if (cpdError) return settle({ error: "Attendance saved, but couldn't auto-log CPD hours — add them manually." });
  }

  return settle(ok);
}

// ── Gifts & benefits register — Rules of Conduct probity/conflicts control.
// Anything over the agency's threshold is auto-flagged for licensee review,
// same "flag, don't silently pass" principle as the rest of the app. ──────
export async function addGift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();

  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("gift_threshold")
    .eq("id", profile.agency_id)
    .maybeSingle();
  // Fallback matches the statutory figure — Property and Stock Agents
  // Regulation 2022 (NSW) cl 20 prescribes $60 for s53F(2)(d), the point at
  // which a gift stops being exempt from the conflict-of-interest
  // prohibition. See 0011_gift_threshold_statutory_amount.sql.
  const threshold = (agencyRow as { gift_threshold: number } | null)?.gift_threshold ?? 60;

  const giftDate = str(formData, "giftDate");
  const description = str(formData, "description");
  const counterparty = str(formData, "counterparty");
  const valueRaw = str(formData, "value");
  const direction = (str(formData, "direction") ?? "received") as GiftDirection;
  const agentId = str(formData, "profileId") ?? profile.id;
  const notes = str(formData, "notes");

  // An agent logs their own gifts; the licensee can log one for anyone.
  if (agentId !== profile.id && !access.actsAsLicensee) {
    return { error: "You can log your own gifts. Ask the licensee to log one for someone else." };
  }
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
  const { supabase, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  await supabase.from("gifts").update({ status: "reviewed" }).eq("id", giftId).eq("status", "flagged");
  revalidatePath("/dashboard/registers");
}

export async function deleteGift(giftId: string): Promise<void> {
  const { supabase, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  await supabase.from("gifts").delete().eq("id", giftId);
  revalidatePath("/dashboard/registers");
}

export async function updateGiftThreshold(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can change the threshold." };

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
  const { supabase, profile, access } = await requireAuthContext();
  // REVERSAL (Adam, 9 Oct 2026): complaints are the licensee in charge's
  // only, for everyone. "Complaints should go directly to a licensee."
  if (!access.officeLicensee) return { error: "Complaints go to the licensee in charge." };

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
  const { supabase, access } = await requireAuthContext();
  if (!access.officeLicensee) return;
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
  const { supabase, access } = await requireAuthContext();
  if (!access.officeLicensee) return;
  await supabase.from("complaints").delete().eq("id", complaintId);
  revalidatePath("/dashboard/registers");
}

// ── SG Manual — simple upload + version history. Current version is just
// the most recent row; older ones stay on file for the audit trail. Every
// new version also publishes a sign-off document (Adam, 9 Aug 2026) so
// every staff member has to individually acknowledge it, same file, no
// separate upload — see signoffs.ts and the Document sign-offs register.
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

  if (!error) {
    // Best-effort: the version is already saved above regardless of whether
    // this succeeds, so a sign-off setup failure never loses the upload.
    await createSignoffDocument({
      category: "sg_manual",
      title: versionLabel ? `Supervision Guidelines Manual — ${versionLabel}` : "Supervision Guidelines Manual",
      periodLabel: null,
      filePath: path,
      fileName,
      notes,
      signerScope: "all_staff",
    });
  }

  revalidatePath("/dashboard/sg-manual");
  return { error: error ? "Couldn't save that version — try again." : null };
}

// ── Breach / corrective-actions register — Supervision Guidelines Req 3. ───
// The requirement is to document the non-compliance *and* the corrective
// action, so logging a breach and recording what was done about it are
// separate steps rather than one long form: a breach usually gets logged the
// moment it's spotted, and the remedy lands later. See
// supabase/migrations/0012_breach_register.sql for the s89 notification
// clock behind `notifiable` / `notified_date`.
export async function addBreach(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();

  const identifiedDate = str(formData, "identifiedDate");
  const description = str(formData, "description");
  const category = (str(formData, "category") ?? "other") as BreachCategory;
  const severity = (str(formData, "severity") ?? "minor") as BreachSeverity;
  const agentId = str(formData, "agentId");
  const propertyId = str(formData, "propertyId");
  const notifiable = formData.get("notifiable") === "on";
  const notes = str(formData, "notes");

  if (!identifiedDate) return { error: "Enter the date this was identified." };
  if (!description) return { error: "Describe what happened." };
  // Anyone can log their own breach and sees only those they logged (Adam,
  // 9 Oct 2026); only the licensee records one against someone else.
  if (agentId && agentId !== profile.id && !access.actsAsLicensee) {
    return { error: "You can log your own breaches. The licensee records one against someone else." };
  }

  const { error } = await supabase.from("breaches").insert({
    agency_id: profile.agency_id,
    identified_date: identifiedDate,
    description,
    category,
    severity,
    agent_id: agentId,
    property_id: propertyId,
    notifiable,
    status: "open",
    notes,
    created_by: profile.id,
  });

  if (error) return { error: "Couldn't save that breach — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

// Recording the remedy is what actually satisfies Req 3, so this also moves
// the breach out of "open" — an entry with a corrective action still showing
// as open would misrepresent the register's own summary counts.
export async function recordCorrectiveAction(
  breachId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireAuthContext();

  const correctiveAction = str(formData, "correctiveAction");
  const correctiveActionDate = str(formData, "correctiveActionDate") ?? new Date().toISOString().slice(0, 10);

  if (!correctiveAction) return { error: "Describe the corrective action taken." };

  const { error } = await supabase
    .from("breaches")
    .update({
      corrective_action: correctiveAction,
      corrective_action_date: correctiveActionDate,
      status: "action_taken",
    })
    .eq("id", breachId);

  if (error) return { error: "Couldn't save that — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

// Separate from the corrective action: notifying Fair Trading is its own
// obligation with its own date, and for a trust account overdrawn under s89
// it carries a 5-day deadline from the date the agency became aware.
export async function recordBreachNotification(
  breachId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireAuthContext();

  const notifiedDate = str(formData, "notifiedDate") ?? new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("breaches").update({ notified_date: notifiedDate }).eq("id", breachId);

  if (error) return { error: "Couldn't record that notification — try again." };
  revalidatePath("/dashboard/registers");
  return ok;
}

// Closing is licensee-only: signing off that a breach is dealt with is a
// supervision judgement, the same trust level as the other licensee-gated
// actions in this app. The licensee here includes the agent on their own plan
// (access.actsAsLicensee; 0058 lets them close and delete), who could never
// close a breach while this checked the raw flag (10 Oct 2026).
export async function closeBreach(breachId: string): Promise<void> {
  const { supabase, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  await supabase
    .from("breaches")
    .update({ status: "closed", closed_date: new Date().toISOString().slice(0, 10) })
    .eq("id", breachId);
  revalidatePath("/dashboard/registers");
}

export async function deleteBreach(breachId: string): Promise<void> {
  const { supabase, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  await supabase.from("breaches").delete().eq("id", breachId);
  revalidatePath("/dashboard/registers");
}

// ── AML/CTF pre-commencement position — the agency's standing answer, not a
// per-file decision. See 0018_aml_precommencement.sql and
// lib/rules/aml-precommencement.ts for the reasoning. ───────────────────────
export async function setAmlPreCommencement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  // Checked here and again inside the RPC. This one produces a readable
  // message; the RPC is the guard that actually holds if this is bypassed.
  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can take this position." };
  }

  const enabled = String(formData.get("enabled") ?? "") === "on";

  const { error } = await supabase.rpc("set_agency_aml_precommencement", { p_enabled: enabled });
  if (error) return { error: "Couldn't save that — try again." };

  // Both paths: the switch lives here, but what it changes is what agents see
  // on every Stage 0 file.
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard", "layout");
  return ok;
}
