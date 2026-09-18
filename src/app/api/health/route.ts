import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The endpoint an external uptime monitor watches.
//
// WHY THIS EXISTS RATHER THAN POINTING A MONITOR AT THE HOMEPAGE. The homepage
// is a static marketing page. It would render perfectly while the database was
// completely unreachable, and the monitor would stay green while no customer
// could log in, open a file, or record anything. A health check that cannot go
// red for the failure you actually care about is decoration.
//
// So this touches the database. If Supabase is unreachable, this returns 503
// and the monitor fires. That is the whole point.
//
// Raised by Graham (Adam's web developer) on 18 Sep 2026, via Adam: "once we
// get, say, 10 people all trying to use the website at the same time and it
// doesn't work for some reason, what would I do?" Ten concurrent users is not
// a load problem on serverless hosting — but the question underneath it was
// the right one, and the honest answer was that nothing would have told him.
//
// ── WHAT IT DELIBERATELY DOES NOT CHECK ───────────────────────────────────
//
// Backup freshness and cron liveness are NOT here, and leaving them out is a
// decision rather than an omission.
//
//   Backups: the copy job only writes a row when it copies something new, so
//   a week with no uploads leaves a week-old timestamp that is entirely
//   correct. "Last backup was 6 days ago" is not a fault, and a check that
//   cannot tell the difference would either cry wolf or be ignored. The real
//   signal — documents in the bucket versus documents copied — is on the staff
//   page, where it is read deliberately rather than every sixty seconds.
//
//   Crons: a scheduled job stopping silently is a genuine risk, and the right
//   tool is a heartbeat — the job pings a monitor when it finishes, and the
//   monitor alerts when the ping does not arrive. That is the inverse of this
//   check and belongs in the cron routes, not here.
//
// ── WHAT IT RETURNS ───────────────────────────────────────────────────────
//
// Public, because a monitor cannot easily authenticate, so it carries nothing
// worth having: no counts, no names, no configuration, no versions. Whether
// the database answers, and nothing else.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const startedAt = Date.now();

  let databaseOk = false;
  let detail: string | null = null;

  try {
    const supabase = await createClient();

    // The anon client on a tenant table. Row Level Security means this returns
    // no rows to an unauthenticated caller, which is correct and expected —
    // an EMPTY result proves the round trip worked. Only a thrown error or an
    // error object means the database could not be reached, and that is the
    // distinction being tested. Selecting a single id keeps it to the cheapest
    // query that still crosses the network and hits Postgres.
    const { error } = await supabase.from("agencies").select("id").limit(1);

    if (error) {
      detail = error.message.slice(0, 200);
    } else {
      databaseOk = true;
    }
  } catch (e) {
    detail = e instanceof Error ? e.message.slice(0, 200) : "unknown error";
  }

  const body = {
    status: databaseOk ? "ok" : "degraded",
    checks: { app: "ok", database: databaseOk ? "ok" : "fail" },
    ms: Date.now() - startedAt,
    // Only present on failure, and truncated. Enough to tell a timeout from a
    // refused connection without publishing anything about the system.
    ...(detail ? { detail } : {}),
  };

  // 503 rather than 200-with-a-sad-body. Monitors watch the status code, and a
  // check that reports failure with a 200 is a check that never fires.
  return NextResponse.json(body, {
    status: databaseOk ? 200 : 503,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
