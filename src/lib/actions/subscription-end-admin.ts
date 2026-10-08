"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runDeletionJob } from "@/lib/subscription-end/deletion";

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
