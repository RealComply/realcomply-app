import { NextResponse } from "next/server";
import { runWeeklyDigest } from "@/lib/email/weekly-digest";
import { sendReaderWeek } from "@/lib/email/reader-week";
import { monitoredJob, reminderProblems } from "@/lib/monitoring/check-in";
import { createServiceClient } from "@/lib/supabase/service";

// Vercel Cron calls this every Monday (see vercel.json — fixed at 21:00
// UTC Sunday) with an "Authorization: Bearer <CRON_SECRET>" header it adds
// automatically once CRON_SECRET is set in the project's environment
// variables — that's the only thing standing between this route and
// anyone who finds the URL, so don't relax this check.
//
// Note: 21:00 UTC is Monday 8am in Sydney during daylight saving (AEDT,
// UTC+11) but Monday 7am during standard time (AEST, UTC+10) — NSW shifts
// twice a year and Vercel Cron schedules are fixed UTC, so the local send
// time drifts by an hour around each changeover. Not worth solving with an
// hourly-trigger-plus-local-time-check for a "roughly Monday morning"
// digest; revisit only if the hour drift actually bothers anyone.
//
// Can also be hit manually (with the same header) to test without waiting
// for Monday — e.g. `curl -H "Authorization: Bearer $CRON_SECRET"
// https://realcomply.com.au/api/cron/weekly-digest`.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Then Adam's weekly staff email: the week's document reads (1 Nov 2026;
  // lib/email/reader-week). Part of the same job, so one that can't be sent
  // is a failed email in the job's check-in and Adam's alert like any other.
  const result = await monitoredJob(
    "weekly-digest",
    async () => {
      const digest = await runWeeklyDigest();
      let staffEmailSent = false;
      try {
        staffEmailSent = await sendReaderWeek(createServiceClient() as unknown as Parameters<typeof sendReaderWeek>[0], new Date());
      } catch (e) {
        console.error("weekly staff email failed:", e instanceof Error ? e.message : String(e));
      }
      return { ...digest, failed: digest.failed + (staffEmailSent ? 0 : 1), staffEmail: staffEmailSent ? "sent" : "failed" };
    },
    reminderProblems,
  );
  return NextResponse.json(result);
}
