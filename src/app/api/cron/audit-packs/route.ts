import { NextResponse } from "next/server";
import { clearOldAuditPacks } from "@/lib/pdf/audit-pack-store";
import { monitoredJob } from "@/lib/monitoring/check-in";
import { createServiceClient } from "@/lib/supabase/service";

// The hourly clean-up of finished audit packs (Adam, 2 Nov 2026). A pack is
// a full copy of a listing's documents, so a copy is kept only as long as its
// 10-minute download link (lib/pdf/audit-pack-store.ts): this deletes every
// copy whose link has run out. Reports to Healthchecks as "audit-packs", like
// the other jobs, and emails Adam if a copy couldn't be deleted.
//
// Same CRON_SECRET bearer check as every other job.
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;

  if (!expected || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await monitoredJob("audit-packs", () => clearOldAuditPacks(createServiceClient()), (r) =>
    r.problem ? [`Finished audit packs could not be cleared: ${r.problem}`] : [],
  );
  return NextResponse.json(result);
}
