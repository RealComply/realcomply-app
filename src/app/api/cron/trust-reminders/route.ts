import { NextResponse } from "next/server";
import { runTrustReminders } from "@/lib/email/trust-reminders";

// Daily at 21:40 UTC (see vercel.json) — ten minutes behind the licence
// reminders, so the two jobs do not contend and a bad morning is easy to tell
// apart in the logs.
//
// Daily rather than monthly, even though it only has something to say on three
// days of the month. A monthly cron that fails on the 1st has to wait a month;
// a daily one that finds nothing to do returns in milliseconds and costs
// nothing. The decision about whether today is a reminder day lives in
// lib/trust-account.ts, where it can be tested without a scheduler.
//
// Same CRON_SECRET bearer check as the other jobs; that header is the only
// thing standing between this route and anyone who finds the URL.
//
// Testable by hand with the same header:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://realcomply.com.au/api/cron/trust-reminders
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runTrustReminders();
  return NextResponse.json(result);
}
