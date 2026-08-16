import { NextResponse } from "next/server";
import { runWeeklyListingScan } from "@/lib/actions/website-scan";

// The weekly advertised-price check. Same guard as the digest route: Vercel
// Cron adds "Authorization: Bearer <CRON_SECRET>" automatically, and that
// header is the only thing between this route and anyone who finds the URL.
//
// Scheduled an hour before the weekly digest (see vercel.json) so Monday's
// email reports findings from a fresh check rather than last week's.
//
// Can be run by hand from the Vercel dashboard: Project Settings → Cron Jobs →
// Run. That path needs no secret, since Vercel supplies the header itself.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWeeklyListingScan();
  return NextResponse.json(result);
}
