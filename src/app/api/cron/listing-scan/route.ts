import { NextResponse } from "next/server";
import { runDailyListingScan } from "@/lib/actions/website-scan";
import { scanModeAt, sydneyHour } from "@/lib/listing-scan-schedule";

// The advertised-price check, at 7am Sydney time: weekly on Mondays until 31
// October 2026, then every live listing every morning from 1 November (see
// lib/listing-scan-schedule.ts). Pages for unlinked listings are looked for
// every morning throughout. Same guard as the digest route: Vercel Cron adds
// "Authorization: Bearer <CRON_SECRET>" automatically, and that header is the
// only thing between this route and anyone who finds the URL.
//
// 7AM SYDNEY ALL YEAR. Vercel Cron schedules are UTC only, and 7am in Sydney
// is 20:00 UTC under daylight saving (AEDT, October to April) and 21:00 UTC
// outside it (AEST). vercel.json fires at both; whichever one is not 7am in
// Sydney that day returns without doing anything. One run a day, never two.
//
// The weekly digest fires at 21:00 UTC on Sundays: an hour after this check
// under daylight saving, but at the same moment outside it, when Monday's
// digest may report the previous morning's findings.
//
// Can be run by hand from the Vercel dashboard (Project Settings → Cron Jobs →
// Run), but only does anything at 7am Sydney time; outside that, use Check now
// on the listing.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const hour = sydneyHour(now);
  if (hour !== 7) {
    return NextResponse.json({ skipped: `Not 7am in Sydney (it is ${hour}:00 there).` });
  }

  const result = { mode: scanModeAt(now), ...(await runDailyListingScan()) };
  // One line per run in the Vercel logs. Each finding keeps only its latest
  // check, so this is the record of how many pages were read vs skipped, and
  // what the reads cost, from day to day. Excludes page discovery.
  console.log("listing-scan", JSON.stringify(result));
  return NextResponse.json(result);
}
