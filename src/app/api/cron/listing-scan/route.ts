import { NextResponse } from "next/server";
import { runDailyListingScan } from "@/lib/actions/website-scan";

// The daily advertised-price check, 20:00 UTC (7am Sydney in daylight saving,
// 6am otherwise — Vercel Cron schedules are UTC only). Same guard as the digest route: Vercel
// Cron adds "Authorization: Bearer <CRON_SECRET>" automatically, and that
// header is the only thing between this route and anyone who finds the URL.
//
// Sunday's run lands an hour before the weekly digest (see vercel.json), so
// Monday's email reports findings from that morning's check.
//
// Can be run by hand from the Vercel dashboard: Project Settings → Cron Jobs →
// Run. That path needs no secret, since Vercel supplies the header itself.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDailyListingScan();
  // One line per run in the Vercel logs. Each finding keeps only its latest
  // check, so this is the record of how many pages were read vs skipped, and
  // what the reads cost, from day to day. Excludes page discovery.
  console.log("listing-scan", JSON.stringify(result));
  return NextResponse.json(result);
}
