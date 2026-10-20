import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildSgAnnexurePdf, sgAnnexureFilename } from "@/lib/pdf/sg-annexure";
import { SG_ANNEXURE_VERSION } from "@/lib/legal/sg-annexure";
import { linkDetails, logoFor } from "@/lib/sg-annexure/adopt";
import { formalAgencyName } from "@/lib/agency-names";

// "Download the full annexure (PDF)" on the signing page (brief, 14 Oct 2026):
// the annexure with the agency's name and licence number, the adoption left
// blank. The token is the only credential, as on the page; "preview" (the
// test email's page) gives the same document for a made-up office.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = token === "preview";
  const details = preview ? null : await linkDetails(await createClient(), token, SG_ANNEXURE_VERSION);
  if (!preview && !details) notFound();

  const agencyName = details?.agencyName ?? "Your agency";
  const pdf = await buildSgAnnexurePdf({
    // "[licensed entity name] trading as [trading name]" (brief, 14 Oct 2026).
    agencyName: formalAgencyName({ tradingName: agencyName, licensedEntityName: details?.licensedEntityName ?? null }),
    licenceNumber: details?.licenceNumber ?? null,
    effectiveDate: null,
    logo: details?.logoPath ? await logoFor(createServiceClient(), details.logoPath, details.agencyId) : null,
    adoption: null,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // A header carries plain ASCII only, so an accented office name loses its accents here.
      "Content-Disposition": `inline; filename="${sgAnnexureFilename(agencyName, false).replace(/[^\x20-\x7E]|"/g, "")}"`,
      "Cache-Control": "no-store",
      // Never indexed: the token is the only thing protecting it.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
