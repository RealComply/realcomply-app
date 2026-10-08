import { createServiceClient } from "@/lib/supabase/service";
import { onOrAfter, reminderDate } from "./dates";
import { sendEndedEmail, type SendResult } from "./emails";

/**
 * The day 0 and day 7 emails, for every ended agency that is owed one.
 *
 * Day 0 normally goes from the Stripe webhook the moment the subscription
 * ends. This catches any the webhook missed. sendEndedEmail reads the live
 * row and stays quiet if the agency has been reactivated or already emailed.
 */
export async function runEndedNotices(now: Date = new Date()): Promise<Record<SendResult, number>> {
  const supabase = createServiceClient();
  const tally: Record<SendResult, number> = { sent: 0, skipped: 0, send_failed: 0 };

  const { data } = await supabase
    .from("agencies")
    .select("id, ended_at, ended_notice_sent_at, ended_reminder_sent_at")
    .not("ended_at", "is", null);

  for (const agency of (data ?? []) as Array<{
    id: string;
    ended_at: string;
    ended_notice_sent_at: string | null;
    ended_reminder_sent_at: string | null;
  }>) {
    if (!agency.ended_notice_sent_at) {
      tally[await sendEndedEmail(supabase, agency.id, "day0")] += 1;
    }
    if (!agency.ended_reminder_sent_at && onOrAfter(reminderDate(new Date(agency.ended_at)), now)) {
      tally[await sendEndedEmail(supabase, agency.id, "day7")] += 1;
    }
  }

  return tally;
}
