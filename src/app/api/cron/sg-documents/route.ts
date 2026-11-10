import { NextResponse } from "next/server";
import { monitoredJob } from "@/lib/monitoring/check-in";
import { createServiceClient } from "@/lib/supabase/service";
import { advanceSgRead } from "@/lib/sg-document/advance";
import { documentsBeingRead, sgReadStore, startDraftsFromFilesOnRecord } from "@/lib/sg-document/store";

// Hourly (vercel.json): reads the supervision guidelines nobody is waiting
// on (part 1, 10 Nov 2026).
//   1. The manuals already on file (Master, 10 Nov 2026: "A"): each office's
//      newest Word or PDF manual is read into a draft, once. It stays a draft
//      until the licensee in charge or an office manager checks and saves it.
//   2. Any read left part way, because the page was closed or the reader was
//      busy, is carried on from where it stopped.
// Same CRON_SECRET bearer check as every other job; reports to Healthchecks
// as "sg-documents".
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await monitoredJob(
    "sg-documents",
    async () => {
      const service = createServiceClient();
      const started = await startDraftsFromFilesOnRecord(service);
      const store = sgReadStore(service);
      // Stop starting new work with a minute to spare.
      const until = Date.now() + 230_000;
      let drafts = 0;
      let failed = 0;
      let stillReading = 0;
      for (const id of await documentsBeingRead(service)) {
        if (Date.now() >= until) {
          stillReading++;
          continue;
        }
        const progress = await advanceSgRead(store, id, { until });
        if (progress.status === "draft") drafts++;
        else if (progress.status === "read_failed") failed++;
        else stillReading++;
      }
      return { started, drafts, failed, stillReading };
    },
    (r) => (r.failed > 0 ? [`${r.failed} supervision guidelines document${r.failed === 1 ? "" : "s"} couldn't be read`] : []),
  );
  return NextResponse.json(result);
}
