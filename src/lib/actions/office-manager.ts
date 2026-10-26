"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireProfile } from "@/lib/data/current-profile";
import { appBaseUrl } from "@/lib/site-url";
import { sendEmail } from "@/lib/email/send";
import {
  buildOfficeManagerApprovedEmail,
  buildOfficeManagerRequestEmail,
  buildOfficeManagerWithdrawnEmail,
} from "@/lib/email/office-manager";
import { formatAuDate, formatAuTimestamp } from "@/lib/format-date";

// The office manager role (0093; Adam, 26 Oct 2026). The database decides
// everything: who may ask, who may approve, who may withdraw, and the words.
// These actions send the emails around it and say what happened.
//
// A link token is read only here, with the service key, to put it in an
// email. The person asking never sees the licensee's token: whoever holds it
// can approve.

/** The database's own sentence when one of 0093's rules refuses, otherwise a plain fallback. */
function refusal(error: { code?: string; message?: string } | null, fallback: string): string {
  if (error?.code === "P0001" && error.message) return error.message;
  if (error?.code === "42501" && error.message) return error.message;
  return fallback;
}

const trimName = (name: string | null | undefined, email: string | null | undefined) =>
  (name ?? "").trim() || (email ?? "").trim();

// ── Asking a licensee with no login ───────────────────────────────────────

export type AskState = { error: string | null; sent: boolean };

/** Builds and sends the licensee's email. The token is read here, with the service key, and nowhere else. */
async function emailTheRequest(
  requestId: string,
  profile: { agency_id: string; full_name: string | null; email: string | null },
): Promise<boolean> {
  const service = createServiceClient();
  const { data: row } = await service
    .from("office_manager_requests")
    .select("token, sent_to, wording, expires_at, agency_id")
    .eq("id", requestId)
    .maybeSingle();
  const request = row as { token: string; sent_to: string; wording: string; expires_at: string; agency_id: string } | null;
  if (!request || request.agency_id !== profile.agency_id) return false;
  const { data: agency } = await service.from("agencies").select("name").eq("id", profile.agency_id).maybeSingle();
  const email = buildOfficeManagerRequestEmail({
    personName: trimName(profile.full_name, profile.email),
    officeName: ((agency as { name?: string } | null)?.name ?? "").trim(),
    wording: request.wording,
    url: `${appBaseUrl()}/office-manager/${request.token}`,
    expiresAt: formatAuDate(request.expires_at.slice(0, 10)),
  });
  return sendEmail({ to: request.sent_to, ...email, ...(profile.email ? { replyTo: profile.email } : {}) });
}

/** Asks (or asks again with the same link). Emails the licensee and records whether it went. */
export async function askLicenseeToApprove(): Promise<AskState> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: requestId, error } = await supabase.rpc("request_office_manager");
  if (error || typeof requestId !== "string") {
    return { error: refusal(error, "We couldn't make the request. Try again in a few minutes."), sent: false };
  }

  // Never throws: a failed send leaves the request standing, recorded as not
  // sent, so "Send again" can try again (as sign-off links do, 0047).
  let sent = false;
  try {
    sent = await emailTheRequest(requestId, profile);
  } catch (e) {
    console.error("office manager request email failed", requestId, e);
  }
  await supabase.rpc("record_office_manager_request_email", { p_request_id: requestId, p_sent: sent });

  revalidatePath("/dashboard/home");
  return sent
    ? { error: null, sent: true }
    : { error: "The email could not be sent. Try sending it again in a few minutes.", sent: false };
}

/** The person asking takes their request back. */
export async function cancelOfficeManagerRequest(): Promise<void> {
  await requireProfile();
  const supabase = await createClient();
  await supabase.rpc("cancel_office_manager_request");
  revalidatePath("/dashboard/home");
}

// ── The licensee's link pages (no login) ─────────────────────────────────

export type ApproveState = { error: string | null; approved: boolean; approvedAt?: string; approvedByName?: string };

/** The licensee approves by typing their name. Their confirmation email carries the withdraw link. */
export async function approveOfficeManagerByLink(_prev: ApproveState, formData: FormData): Promise<ApproveState> {
  const token = String(formData.get("token") ?? "");
  const typedName = String(formData.get("typedName") ?? "").trim();
  if (!typedName) return { error: "Type your full name to approve.", approved: false };
  if (typedName.length > 120) return { error: "Type your name only, up to 120 characters.", approved: false };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_office_manager", { p_token: token, p_typed_name: typedName });
  if (error || data !== true) {
    return {
      error: "This link is no longer valid. It may have expired, been withdrawn, or already been approved.",
      approved: false,
    };
  }

  // The licensee's copy of the record, by email. The approval stands whether
  // or not the email goes.
  try {
    const copy = await emailTheApproval(token);
    if (copy) return { error: null, approved: true, ...copy };
  } catch (e) {
    console.error("office manager approval email failed", e);
  }
  return { error: null, approved: true, approvedByName: typedName };
}

/** Emails the licensee their confirmation, with the withdraw link. Returns when and by whom it was approved. */
async function emailTheApproval(token: string): Promise<{ approvedAt: string; approvedByName: string } | null> {
  const service = createServiceClient();
  const { data: req } = await service
    .from("office_manager_requests")
    .select("id, sent_to, agency_id, profile_id")
    .eq("token", token)
    .maybeSingle();
  const request = req as { id: string; sent_to: string; agency_id: string; profile_id: string } | null;
  if (!request) return null;
  const [{ data: managerRow }, { data: person }, { data: agency }] = await Promise.all([
    service
      .from("office_managers")
      .select("wording, approved_at, approved_by_name, withdraw_token")
      .eq("request_id", request.id)
      .maybeSingle(),
    service.from("profiles").select("full_name, email").eq("id", request.profile_id).maybeSingle(),
    service.from("agencies").select("name").eq("id", request.agency_id).maybeSingle(),
  ]);
  const manager = managerRow as { wording: string; approved_at: string; approved_by_name: string; withdraw_token: string } | null;
  const who = person as { full_name: string | null; email: string | null } | null;
  if (!manager) return null;
  const email = buildOfficeManagerApprovedEmail({
    personName: trimName(who?.full_name, who?.email),
    officeName: ((agency as { name?: string } | null)?.name ?? "").trim(),
    approvedByName: manager.approved_by_name,
    approvedAt: formatAuTimestamp(manager.approved_at),
    wording: manager.wording,
    withdrawUrl: `${appBaseUrl()}/office-manager/withdraw/${manager.withdraw_token}`,
  });
  await sendEmail({ to: request.sent_to, ...email, ...(who?.email ? { replyTo: who.email } : {}) });
  return { approvedAt: manager.approved_at, approvedByName: manager.approved_by_name };
}

export type WithdrawState = { error: string | null; withdrawn: boolean; withdrawnAt?: string };

/** Lets the office manager know, whoever withdrew it and however. */
async function tellOfficeManager(withdraw: { profile_id: string; agency_id: string; withdrawn_at: string; withdrawn_by_name: string | null }) {
  const service = createServiceClient();
  const [{ data: person }, { data: agency }] = await Promise.all([
    service.from("profiles").select("full_name, email").eq("id", withdraw.profile_id).maybeSingle(),
    service.from("agencies").select("name").eq("id", withdraw.agency_id).maybeSingle(),
  ]);
  const who = person as { full_name: string | null; email: string | null } | null;
  if (!who?.email) return;
  const email = buildOfficeManagerWithdrawnEmail({
    personName: trimName(who.full_name, who.email),
    officeName: ((agency as { name?: string } | null)?.name ?? "").trim(),
    withdrawnByName: (withdraw.withdrawn_by_name ?? "").trim() || "Your licensee in charge",
    withdrawnAt: formatAuTimestamp(withdraw.withdrawn_at),
  });
  await sendEmail({ to: who.email, ...email });
}

/** The licensee withdraws by the link in their confirmation email. Opening the page changes nothing. */
export async function withdrawOfficeManagerByLink(_prev: WithdrawState, formData: FormData): Promise<WithdrawState> {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_office_manager_by_token", { p_token: token });
  if (error || data !== true) {
    return { error: "This link is no longer valid. The approval may already have been withdrawn.", withdrawn: false };
  }
  // The withdrawal stands whether or not the email to the office manager goes.
  try {
    const { data: row } = await createServiceClient()
      .from("office_managers")
      .select("profile_id, agency_id, withdrawn_at, withdrawn_by_name")
      .eq("withdraw_token", token)
      .maybeSingle();
    const done = row as { profile_id: string; agency_id: string; withdrawn_at: string; withdrawn_by_name: string | null } | null;
    if (done) {
      await tellOfficeManager(done);
      return { error: null, withdrawn: true, withdrawnAt: done.withdrawn_at };
    }
  } catch (e) {
    console.error("office manager withdrawal email failed", e);
  }
  return { error: null, withdrawn: true };
}

// ── The licensee with a login, in Team ───────────────────────────────────

export type TeamOfficeManagerState = { error: string | null };

export async function grantOfficeManager(
  profileId: string,
  _prev: TeamOfficeManagerState,
  formData: FormData,
): Promise<TeamOfficeManagerState> {
  await requireProfile();
  if (formData.get("authorise") !== "yes") return { error: "Tick the box to confirm." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_office_manager", { p_profile_id: profileId });
  if (error) return { error: refusal(error, "That didn't work. Try again.") };
  revalidatePath("/dashboard/team");
  return { error: null };
}

export async function withdrawOfficeManager(profileId: string): Promise<TeamOfficeManagerState> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_office_manager", { p_profile_id: profileId });
  if (error || data !== true) return { error: refusal(error, "That didn't work. Try again.") };
  const { data: row } = await supabase
    .from("office_managers")
    .select("profile_id, agency_id, withdrawn_at, withdrawn_by_name")
    .eq("agency_id", profile.agency_id)
    .eq("profile_id", profileId)
    .not("withdrawn_at", "is", null)
    .order("withdrawn_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (row) {
    try {
      await tellOfficeManager(row as { profile_id: string; agency_id: string; withdrawn_at: string; withdrawn_by_name: string | null });
    } catch (e) {
      console.error("office manager withdrawal email failed", e);
    }
  }
  revalidatePath("/dashboard/team");
  return { error: null };
}
