import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/data/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { officeFor } from "@/lib/licensee-signoff/server";
import { draftItems, draftMonth, packItemsOf, packPdfInput, packsFor, type PackRow } from "@/lib/licensee-signoff/pack";
import { buildSignoffPackPdf } from "@/lib/pdf/signoff-pack";
import { monthName } from "@/lib/licensee-signoff/model";

// "Download pack (PDF)" (Adam, 3 Nov 2026): the pack being prepared (?draft=1)
// or a sent one (?pack=), marked "For review. Not yet signed." on every page;
// a signed one opens its signed copy, filed when it was signed. The licensee
// in charge and the office manager only.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { profile, access } = await requireAccess();
  if (!access.runsOffice || access.isAgentPlan) notFound();
  const supabase = await createClient();
  const office = await officeFor(createServiceClient(), profile.agency_id);
  if (!office) notFound();
  const url = new URL(request.url);
  const packId = url.searchParams.get("pack");

  let bytes: Uint8Array;
  let name: string;
  if (packId) {
    const { data } = await supabase
      .from("signoff_packs")
      .select("id, month, sent_at, sent_by_name, signed_at, signed_name, signed_via, signed_file_path, signed_file_name")
      .eq("agency_id", profile.agency_id)
      .eq("id", packId)
      .maybeSingle();
    const pack = data as PackRow | null;
    if (!pack) notFound();
    if (pack.signed_at && pack.signed_file_path) {
      const { data: signed } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(pack.signed_file_path, 600, {
        download: pack.signed_file_name ?? true,
      });
      if (signed?.signedUrl) return noStore(NextResponse.redirect(signed.signedUrl, 303));
    }
    const items = await packItemsOf(supabase, profile.agency_id, pack.id);
    bytes = await buildSignoffPackPdf(packPdfInput(office, pack, items));
    name = `${monthName(pack.month)} sign-off pack${pack.signed_at ? " (signed)" : ""}.pdf`;
  } else {
    const packs = await packsFor(supabase, profile.agency_id);
    const month = draftMonth(packs.sentMonths);
    const items = await draftItems(supabase, profile.agency_id);
    const preparer = {
      name: (profile.full_name ?? "").trim() || profile.email || "the office",
      officeManager: access.isOfficeManager && office.licensee.profileId !== profile.id,
    };
    bytes = await buildSignoffPackPdf(packPdfInput(office, null, items, { month, preparer }));
    name = `${monthName(month)} sign-off pack (for review).pdf`;
  }
  return noStore(
    new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      },
    }),
  );
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
