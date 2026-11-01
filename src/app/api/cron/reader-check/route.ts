import { NextResponse } from "next/server";
import { readerCheckProblems, readerCheckSummary, runReaderCheck } from "@/lib/documents/reader-check";
import { monitoredJob } from "@/lib/monitoring/check-in";

// The daily reader check (Adam, 1 Nov 2026; lib/documents/reader-check): the
// real reader reads the made-up 27-sale comparable-sales report, and Adam is
// emailed if the read fails or it doesn't find 27 sales. Reports to
// Healthchecks as "reader-check", like the other jobs.
//
// 19:15 UTC every day (vercel.json): 6:15am in Sydney under daylight saving,
// 5:15am outside it. Early morning either way, before the 7am listing check
// and before anyone starts work. Same guard as every job: Vercel Cron sends
// "Authorization: Bearer <CRON_SECRET>", and nothing else gets in.
//
// Can be run by hand from the Vercel dashboard (Project Settings → Cron Jobs
// → Run). The staff page has a test that emails the result to a test address.

// A long report takes the reader up to a minute or two to answer.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await monitoredJob("reader-check", () => runReaderCheck(), readerCheckProblems);
  // One line per run in the Vercel logs: what the reader found, and how long it took.
  console.log("reader-check", readerCheckSummary(result));
  return NextResponse.json(result);
}
