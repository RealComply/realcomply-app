import { NextResponse } from "next/server";
import { runPmRetentionReminders } from "@/lib/email/pm-retention";

// Daily at 21:50 UTC (see vercel.json), before the working day in Sydney. The
// 3-year property management file reminder (brief B4). Sends only on the day
// a file reaches 3 years, so most mornings it sends nothing at all.
//
// Same CRON_SECRET bearer check as the other daily jobs.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runPmRetentionReminders();
  return NextResponse.json(result);
}
