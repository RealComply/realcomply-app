import { NextResponse } from "next/server";
import { runStorageBackup } from "@/lib/backup/storage-backup";

// Copies uploaded documents out to the independent backup bucket.
//
// Hourly (see vercel.json), not nightly, and that is deliberate. A nightly job
// that fails loses a day and has to wait a day to try again. An hourly one
// that finds nothing to do returns in well under a second and costs nothing,
// and a batch that hits the function's time limit is simply picked up an hour
// later — see the resumable design in lib/backup/storage-backup.ts.
//
// It also narrows the window. The worst case for an agency is a document
// uploaded and then lost before it was ever copied; hourly makes that window
// an hour rather than a day.
//
// maxDuration raised because this moves real files — a 30MB contract over the
// network is not instant, and the batch limit exists so a run ends cleanly
// rather than being cut off mid-upload.
//
// Same CRON_SECRET bearer check as every other job; that header is the only
// thing between this route and anyone who finds the URL.
//
// Testable by hand:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//     https://www.realcomply.com.au/api/cron/backup-storage
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runStorageBackup({ limit: 50 });

  // 200 even when the backup is unconfigured or a file failed. The body says
  // what happened, and Vercel's cron view showing red for "not set up yet"
  // would train exactly the wrong reflex about a job whose whole purpose is
  // that somebody notices when it stops.
  return NextResponse.json(result);
}
