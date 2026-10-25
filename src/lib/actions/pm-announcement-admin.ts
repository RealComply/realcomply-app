"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  PM_ANNOUNCEMENT_TEST_ADDRESS,
  PM_ANNOUNCEMENT_TEST_OFFICE,
  pmAnnouncementTest,
  sendPmAnnouncement,
} from "@/lib/email/pm-announcement";

// The property management announcement on the staff page (Adam, 22 Oct 2026).
// RealComply staff only. Two buttons, in this order:
//
//   1. The test: the email exactly as Foster's licensee gets it, to
//      getadamc3+pmannounce@gmail.com and nowhere else. Nothing is recorded.
//   2. The five, once Adam has said "send". Each office once: the record is
//      written before each email, so pressing it again sends nothing.

export type PmAnnouncementState = { error: string | null; notice?: string };

const notStaff = "Only RealComply staff can do that.";

export async function sendPmAnnouncementTest(): Promise<PmAnnouncementState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };

  const test = await pmAnnouncementTest(createServiceClient());
  if ("error" in test) return { error: test.error };
  const ok = await sendEmail(test.email);
  if (!ok) return { error: "The test didn't send. The email provider refused it; check the email settings." };
  return {
    error: null,
    notice: `Sent the test to ${PM_ANNOUNCEMENT_TEST_ADDRESS}, filled in as if for ${PM_ANNOUNCEMENT_TEST_OFFICE} (${
      test.row.firstName ?? "no first name"
    }). Nothing recorded.`,
  };
}

export async function sendPmAnnouncementToOffices(
  _prev: PmAnnouncementState,
  formData: FormData,
): Promise<PmAnnouncementState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };
  if (formData.get("confirm") !== "yes") return { error: "Tick the box to confirm the list first." };

  const result = await sendPmAnnouncement({ supabase: createServiceClient() });
  revalidatePath("/dashboard/admin");
  const summary =
    `${result.sent} sent, ${result.alreadySent} already sent, ` +
    `${result.notSent} not sent (problem), ${result.failed} failed.`;
  return {
    error: result.failed > 0 ? `${result.failed} didn't send.` : null,
    notice: [summary, ...result.lines].join("\n"),
  };
}
