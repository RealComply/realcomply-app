import { NextResponse } from "next/server";
import { runDailyListingScan } from "@/lib/actions/website-scan";

// The daily advertised-price check: every live listing, every morning at 7am
// Sydney time. Same guard as the digest route: Vercel Cron adds
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

  const sydneyHour = Number(
    new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
  if (sydneyHour !== 7) {
    return NextResponse.json({ skipped: `Not 7am in Sydney (it is ${sydneyHour}:00 there).` });
  }

  const result = await runDailyListingScan();
  // One line per run in the Vercel logs. Each finding keeps only its latest
  // check, so this is the record of how many pages were read vs skipped, and
  // what the reads cost, from day to day. Excludes page discovery.
  console.log("listing-scan", JSON.stringify(result));
  return NextResponse.json(result);
}
