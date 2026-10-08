"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runDeletionJob } from "@/lib/subscription-end/deletion";
import { runEndedNotices } from "@/lib/subscription-end/notices";

// Staff-only actions for ended subscriptions: the legal hold switch (Data
// Retention Policy section 6) and a dry run of the deletion job.
//
// Same order as the staff page: the caller's own platform-admin flag is read
// first, with their own session, and the service client is only created after.

async function requirePlatformAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("profiles").select("is_platform_admin").eq("id", user.id).maybeSingle();
  return (data as { is_platform_admin?: boolean } | null)?.is_platform_admin === true;
}

export type AdminActionState = { error: string | null; message?: string };

export async function setLegalHold(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  if (!(await requirePlatformAdmin())) return { error: "Not allowed." };

  const agencyId = String(formData.get("agency_id") ?? "");
  const on = formData.get("hold") === "on";
  const reason = String(formData.get("reason") ?? "").trim();
  if (!agencyId) return { error: "No agency." };
  if (on && !reason) return { error: "Say why the hold is in place (policy section 6 requires it in writing)." };

  const service = createServiceClient();
  const { error } = await service
    .from("agencies")
    .update({
      legal_hold: on,
      legal_hold_reason: on ? reason : null,
      legal_hold_set_at: on ? new Date().toISOString() : null,
    })
    .eq("id", agencyId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin");
  return { error: null, message: on ? "Hold on. Deletion will skip this agency." : "Hold lifted." };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function runDeletionDryRun(_prev: AdminActionState, _formData: FormData): Promise<AdminActionState> {
  if (!(await requirePlatformAdmin())) return { error: "Not allowed." };
  const report = await runDeletionJob({ dryRun: true, allEnded: true });
  revalidatePath("/dashboard/admin");
  const n = report.outcomes.length;
  return {
    error: null,
    message: n === 0 ? "Dry run done. No agency has an ended subscription." : `Dry run done for ${n} agenc${n === 1 ? "y" : "ies"}. See the log below.`,
  };
}

/** Sends any day 0 or day 7 email that is owed now, as the daily job would. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendOwedEndedEmails(_prev: AdminActionState, _formData: FormData): Promise<AdminActionState> {
  if (!(await requirePlatformAdmin())) return { error: "Not allowed." };
  const tally = await runEndedNotices();
  revalidatePath("/dashboard/admin");
  return {
    error: null,
    message: `Sent ${tally.sent}, nothing owed for ${tally.skipped}, failed ${tally.send_failed}.`,
  };
}

/**
 * Runs the real day-14 deletion for ONE agency now, without waiting for its
 * date. For testing on a throwaway agency in a preview (brief of 8 Oct 2026,
 * "a real run on the throwaway agency only").
 *
 * NEVER ON THE LIVE SITE: refused when VERCEL_ENV is production, so the
 * button cannot exist where real offices are. The name must be typed exactly,
 * and the job's own guards still refuse a protected office or one on hold.
 */
export async function deleteAgencyNowForTesting(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  if (!deletionNowAllowed()) return { error: "Not available on the live site." };
  if (!(await requirePlatformAdmin())) return { error: "Not allowed." };

  const agencyId = String(formData.get("agency_id") ?? "");
  const typed = String(formData.get("confirm_name") ?? "").trim();

  const service = createServiceClient();
  const { data } = await service.from("agencies").select("name, ended_at").eq("id", agencyId).maybeSingle();
  const agency = data as { name: string; ended_at: string | null } | null;
  if (!agency?.ended_at) return { error: "That agency has not ended." };
  if (typed !== agency.name) return { error: `Type the agency's name exactly ("${agency.name}") to confirm.` };

  const report = await runDeletionJob({ dryRun: false, agencyId, force: true });
  revalidatePath("/dashboard/admin");
  const outcome = report.outcomes[0];
  if (!outcome) return { error: "Nothing was run." };
  if (outcome.status !== "completed") return { error: `Not deleted: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ""}.` };
  return { error: null, message: `Deleted. Certificate ${outcome.certificateNumber} has been emailed.` };
}

// Previews only, never the live site. Not exported: a "use server" file may
// only export actions. The staff page makes the same check to decide whether
// to show the button at all.
function deletionNowAllowed(): boolean {
  return process.env.VERCEL_ENV !== "production";
}
