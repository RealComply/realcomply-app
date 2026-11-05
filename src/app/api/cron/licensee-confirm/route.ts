import { NextResponse } from "next/server";
import { monitoredJob } from "@/lib/monitoring/check-in";
import { confirmRunProblems, runLicenseeConfirmations } from "@/lib/licensee-email/daily";

// The licensee email confirms first (0112; Master, 4 Nov 2026): each address
// that has never had the confirm email gets it once. See
// lib/licensee-email/daily.ts.
//
// Daily at 22:05 UTC (see vercel.json). ?dry_run=1 lists the offices and
// addresses it would send to and sends nothing. Same CRON_SECRET bearer check
// as every other job.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<preview>/api/cron/licensee-confirm?dry_run=1"
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  // Only the daily run checks in; a dry run by hand must not count as it.
  const result = dryRun
    ? await runLicenseeConfirmations({ dryRun: true })
    : await monitoredJob("licensee-confirm", () => runLicenseeConfirmations(), confirmRunProblems);
  return NextResponse.json(result);
}
