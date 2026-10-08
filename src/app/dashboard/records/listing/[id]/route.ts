import { NextResponse } from "next/server";
import { auditPackResponse, buildAuditPack } from "@/lib/pdf/audit-pack";
import { recordsAccess } from "@/lib/subscription-end/records";

// One listing's audit pack, from the records page. The same pack as
// /dashboard/[id]/summary/pdf, built with the service client so the account
// holder gets every listing even when RLS would show an agent only their own.
// See lib/subscription-end/records.ts.
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await recordsAccess();
  if (!access) return NextResponse.json({ error: "Not available" }, { status: 403 });

  const pack = await buildAuditPack(
    access.service,
    id,
    access.state.agencyId,
    access.profile.full_name ?? access.profile.email,
  );
  if (!pack) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return auditPackResponse(pack);
}
