"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { staffReminderData } from "@/lib/data/staff-reminders";
import { remindableNow } from "@/lib/staff-reminders/outstanding";
import { buildStaffReminderEmail } from "@/lib/email/staff-reminder";
import { sendEmail } from "@/lib/email/send";
import { appBaseUrl } from "@/lib/site-url";

// Emails the staff who still need to sign the SG Manual, or read and tick
// the annexure and the Supervision Guidelines (Adam, 26 Oct 2026; 0093). The
// licensee or an office manager. Each send is claimed in the database first
// (claim_staff_reminder), which refuses anyone reminded in the last 20 hours,
// so two presses or two people send one email.

export type ReminderSendState = { error: string | null; sent: number; skipped: number; failed: number };

export async function sendStaffReminders(): Promise<ReminderSendState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice) {
    return { error: "Only the licensee in charge or an office manager can send reminders.", sent: 0, skipped: 0, failed: 0 };
  }

  const { stillToDo, sgVersionLabel, officeName } = await staffReminderData(supabase, profile);
  const senderName = profile.full_name?.trim() || profile.email;
  const senderRole = profile.is_licensee_in_charge ? "licensee in charge" : "office manager";
  const now = new Date();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of stillToDo) {
    if (!remindableNow(item.lastRemindedAt, now)) {
      skipped++;
      continue;
    }
    const { data: id, error } = await supabase.rpc("claim_staff_reminder", {
      p_profile_id: item.person.id,
      p_kinds: item.kinds,
    });
    if (error) {
      failed++;
      continue;
    }
    if (typeof id !== "string") {
      skipped++;
      continue;
    }
    const email = buildStaffReminderEmail({
      recipientName: (item.person.full_name?.trim() || item.person.email).split(/\s+/)[0],
      senderName,
      senderRole,
      officeName,
      kinds: item.kinds,
      sgVersionLabel,
      appUrl: appBaseUrl(),
    });
    const ok = await sendEmail({ to: item.person.email, ...email, ...(profile.email ? { replyTo: profile.email } : {}) });
    await supabase.rpc("record_staff_reminder_email", { p_id: id, p_sent: ok });
    if (ok) sent++;
    else failed++;
  }

  revalidatePath("/dashboard/sg-manual");
  return {
    error: failed > 0 ? `${failed} reminder${failed === 1 ? "" : "s"} could not be sent. Try again in a few minutes.` : null,
    sent,
    skipped,
    failed,
  };
}
