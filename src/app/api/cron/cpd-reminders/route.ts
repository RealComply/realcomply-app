import { NextResponse } from "next/server";
import { runCpdReminders } from "@/lib/email/cpd-reminders";
import { monitoredJob, reminderProblems } from "@/lib/monitoring/check-in";

// Daily at 21:45 UTC (see vercel.json): 7:45 or 8:45am in Sydney, depending on
// daylight saving. It sends only on 1 April, 1 May, 1 June and 23 June (and up
// to three days after one of those if that morning's run failed), so most
// mornings it reads the date and stops. Daily rather than on those four dates
// so a failed run is noticed and made up, the same as the licence reminders.
//
// Same CRON_SECRET bearer check as the other jobs; that header is the only
// thing standing between this route and anyone who finds the URL.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await monitoredJob("cpd-reminders", () => runCpdReminders(), reminderProblems);
  return NextResponse.json(result);
}
