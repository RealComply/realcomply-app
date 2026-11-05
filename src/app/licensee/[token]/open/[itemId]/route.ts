import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET, isInFolder } from "@/lib/storage/evidence";
import { buildAuditPack } from "@/lib/pdf/audit-pack";
import { storeAuditPack } from "@/lib/pdf/audit-pack-store";
import { licenseeLinkByToken, linkIsLive, officeFor } from "@/lib/licensee-signoff/server";

// Opens what the licensee is asked to sign, from their emailed link (Adam,
// 3 Nov 2026; 0109): a sales file's audit pack (marked draft until signed,
// as from the sign-off link), or the reconciliation, SG Manual version or
// audit report. The token is the only credential: a live link, and an item
// in its pack (or the link's own item, "item"), or not found. Read with the
// server's access, inside the one office.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params;
  const service = createServiceClient();
  const link = await licenseeLinkByToken(service, token);
  if (!link || !linkIsLive(link)) notFound();
  const agencyId = String(link.agency_id);

  let type: string;
  let id: string;
  if (link.purpose === "pack") {
    const { data } = await service
      .from("signoff_pack_items")
      .select("item_type, item_id")
      .eq("agency_id", agencyId)
      .eq("pack_id", String(link.pack_id))
      .eq("id", itemId)
      .maybeSingle();
    if (!data) notFound();
    type = String((data as Record<string, unknown>).item_type);
    id = String((data as Record<string, unknown>).item_id);
  } else {
    if (itemId !== "item") notFound();
    type = String(link.item_type);
    id = String(link.item_id);
  }

  if (type === "sales_file") {
    const { data: req } = await service
      .from("property_signoff_requests")
      .select("property_id")
      .eq("agency_id", agencyId)
      .eq("id", id)
      .maybeSingle();
    if (!req) notFound();
    const office = await officeFor(service, agencyId);
    const propertyId = String((req as Record<string, unknown>).property_id);
    const pack = await buildAuditPack(service, propertyId, agencyId, office?.licensee.name ?? "the licensee in charge");
    if (!pack) notFound();
    return noStore(NextResponse.redirect(await storeAuditPack(service, pack, { agencyId, propertyId }, { inline: true }), 303));
  }

  let path: string | null = null;
  if (type === "trust_reconciliation" || type === "sg_manual") {
    const { data } = await service.from("signoff_documents").select("file_path").eq("agency_id", agencyId).eq("id", id).maybeSingle();
    path = ((data as Record<string, unknown> | null)?.file_path as string | null) ?? null;
  } else if (type === "trust_audit") {
    const { data } = await service.from("trust_audits").select("file_path").eq("agency_id", agencyId).eq("id", id).maybeSingle();
    path = ((data as Record<string, unknown> | null)?.file_path as string | null) ?? null;
  }
  // Only this office's own folder, as every full-rights read (19 Oct 2026).
  if (!path || !isInFolder(path, `${agencyId}/`)) notFound();
  const { data: signed } = await service.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 600);
  if (!signed?.signedUrl) notFound();
  return noStore(NextResponse.redirect(signed.signedUrl, 303));
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
