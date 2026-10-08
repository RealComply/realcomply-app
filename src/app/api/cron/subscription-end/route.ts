import { NextResponse } from "next/server";
import { runEndedNotices } from "@/lib/subscription-end/notices";
import { expireActivityStore, runDeletionJob } from "@/lib/subscription-end/deletion";

// When a subscription ends: the day 0 and day 7 emails, the day-14 deletion,
// and the end of RealComply's own 7-year activity record. See
// lib/subscription-end/.
//
// Daily at 15:00 UTC (see vercel.json): 2am in Sydney in summer, 1am in
// winter. The records window is counted in Sydney days, so the first run on
// the deletion date is the one that deletes.
//
// DRY RUN. ?dry_run=1 reports what would be deleted, with counts, and deletes
// nothing. ?agency=<id> limits a run to one agency, and ?force=1 with it runs
// that agency now rather than on its deletion date: for testing on a
// throwaway agency only. The protected offices are refused either way.
//
// Same CRON_SECRET bearer check as every other job.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<preview>/api/cron/subscription-end?dry_run=1"
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const agencyId = url.searchParams.get("agency") ?? undefined;
  const force = url.searchParams.get("force") === "1" && Boolean(agencyId);

  // A dry run is only a look: no emails, no expiry.
  const notices = dryRun ? null : await runEndedNotices();
  const deletion = await runDeletionJob({ dryRun, agencyId, force });
  const expired = dryRun ? null : await expireActivityStore();

  return NextResponse.json({ notices, deletion, expired });
}
