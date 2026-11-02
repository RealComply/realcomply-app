import { NextResponse } from "next/server";
import { buildAuditPack } from "@/lib/pdf/audit-pack";
import { storeAuditPack } from "@/lib/pdf/audit-pack-store";
import { recordsAccess } from "@/lib/subscription-end/records";

// One listing's audit pack, from the records page. The same pack as
// /dashboard/[id]/summary/pdf, built with the service client so the account
// holder gets every listing even when RLS would show an agent only their own.
// See lib/subscription-end/records.ts.
//
// Answers with a short-lived link to the stored pack (lib/pdf/audit-pack-store.ts)
// and the stored files it holds, so "Download all records" keeps each
// document once: inside its listing's pack (Adam, 2 Nov 2026).
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await recordsAccess();
  if (!access) return NextResponse.json({ error: "Not available" }, { status: 403 });

  const pack = await buildAuditPack(access.service, id, access.state.agencyId, access.profile.full_name ?? access.profile.email);
  if (!pack) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = await storeAuditPack(access.service, pack, { agencyId: access.state.agencyId, propertyId: id });
  return NextResponse.json({ url, included: pack.included }, { headers: { "Cache-Control": "no-store" } });
}
