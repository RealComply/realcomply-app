import { NextResponse } from "next/server";
import { runSgReviewReminders } from "@/lib/email/sg-review-reminders";
import { monitoredJob, reminderProblems } from "@/lib/monitoring/check-in";

// Daily at 22:10 UTC (see vercel.json): 8:10am in Sydney in winter, 9:10am
// in summer. The annual review reminders for the supervision guidelines
// (0126): most mornings nothing is due and nothing is sent. Each reminder
// goes once (lib/email/sg-review-reminders.ts).
//
// Same CRON_SECRET bearer check as every job; that header is the only thing
// standing between this route and anyone who finds the URL.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await monitoredJob("sg-review-reminders", () => runSgReviewReminders(), reminderProblems);
  return NextResponse.json(result);
}
