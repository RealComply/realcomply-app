import { NextResponse } from "next/server";
import { monitoredJob } from "@/lib/monitoring/check-in";
import { moveDownProblems, runMoveDown } from "@/lib/billing/move-down-run";

// Moving down automatically (Adam, 6 Nov 2026; Terms cl 7.2). See
// lib/billing/move-down.ts for the rule and move-down-run.ts for the run.
//
// Daily at 22:25 UTC (see vercel.json). ?dry_run=1 lists the offices that
// would move and changes nothing. Same CRON_SECRET bearer check as every
// other job.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     "https://<preview>/api/cron/plan-move-down?dry_run=1"
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
    ? await runMoveDown({ dryRun: true })
    : await monitoredJob("plan-move-down", () => runMoveDown(), moveDownProblems);
  return NextResponse.json(result);
}
