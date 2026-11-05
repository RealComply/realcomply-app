import { NextResponse } from "next/server";
import { monitoredJob } from "@/lib/monitoring/check-in";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPackReminders } from "@/lib/licensee-signoff/reminders";

// The "Monthly pack" reminders (Adam, 3 Nov 2026; 0109): daily, so the 1st's
// reminder to send the pack and the licensee's reminder 7 days after it was
// sent go out on time. Each goes once. Same CRON_SECRET bearer check as every
// other job; reports to Healthchecks as "licensee-signoff".
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await monitoredJob("licensee-signoff", () => sendPackReminders(createServiceClient()), (r) =>
    r.failed > 0 ? [`${r.failed} sign-off pack reminder${r.failed === 1 ? "" : "s"} could not be sent`] : [],
  );
  return NextResponse.json(result);
}
