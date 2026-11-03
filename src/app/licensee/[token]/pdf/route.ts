import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { licenseeLinkByToken, linkIsLive, officeFor } from "@/lib/licensee-signoff/server";
import { packItemsOf, packPdfInput, type PackRow } from "@/lib/licensee-signoff/pack";
import { buildSignoffPackPdf } from "@/lib/pdf/signoff-pack";
import { monthName } from "@/lib/licensee-signoff/model";

// "Download pack (PDF)" from the licensee's emailed pack link (Adam, 3 Nov
// 2026): every page "For review. Not yet signed." The token is the credential.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();
  const link = await licenseeLinkByToken(service, token);
  if (!link || !linkIsLive(link) || link.purpose !== "pack") notFound();
  const office = await officeFor(service, String(link.agency_id));
  const { data } = await service
    .from("signoff_packs")
    .select("id, month, sent_at, sent_by_name, signed_at, signed_name, signed_via, signed_file_path, signed_file_name")
    .eq("agency_id", String(link.agency_id))
    .eq("id", String(link.pack_id))
    .maybeSingle();
  const pack = data as PackRow | null;
  if (!office || !pack) notFound();
  const items = await packItemsOf(service, office.id, pack.id);
  const bytes = await buildSignoffPackPdf(packPdfInput(office, pack, items));
  const response = new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${monthName(pack.month)} sign-off pack (for review).pdf"`,
    },
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
