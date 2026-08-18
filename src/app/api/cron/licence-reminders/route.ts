import { NextResponse } from "next/server";
import { runLicenceReminders } from "@/lib/email/licence-reminders";

// Daily at 21:30 UTC (see vercel.json), which is roughly 7:30–8:30am in
// Sydney depending on daylight saving — the same fixed-UTC drift the weekly
// digest already lives with, and the same reasoning applies: "some time
// before the working day starts" is all this needs to be.
//
// Daily rather than weekly on purpose. A licence that crosses its 7-day
// threshold on a Tuesday should not wait until the following Monday to say
// so. The job is cheap — it only sends when a threshold is crossed for the
// first time, so most mornings it sends nothing at all.
//
// Same CRON_SECRET bearer check as the digest; that header is the only thing
// standing between this route and anyone who finds the URL.
//
// Testable by hand with the same header:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://realcomply.com.au/api/cron/licence-reminders
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runLicenceReminders();
  return NextResponse.json(result);
}
