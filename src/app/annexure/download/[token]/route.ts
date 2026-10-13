import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildSgAnnexurePdf } from "@/lib/pdf/sg-annexure";
import { formalAgencyName } from "@/lib/agency-names";

// "Download the annexure for your licensee", for one agent on their own plan
// (brief, 14 Oct 2026, Part 5): the same annexure as /annexure/download, with
// the Agency line filled in from the agent's office, "[licensed entity name]
// trading as [trading name]" or the trading name alone. Licence number and
// effective date stay blank for the licensee to fill in.
//
// Signed out, like /annexure/download: the link is in the agent welcome email.
// The token (agencies.annexure_download_token, 0070) is the credential, and
// annexure_download_details gives the two names and nothing else, for agent
// plans only. An unknown token is a plain 404.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("annexure_download_details", { p_token: token });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { trading_name: string | null; licensed_entity_name: string | null }
    | undefined;
  if (error || !row) notFound();

  const pdf = await buildSgAnnexurePdf({
    agencyName: formalAgencyName({ tradingName: row.trading_name ?? "", licensedEntityName: row.licensed_entity_name }),
    licenceNumber: null,
    effectiveDate: null,
    logo: null,
    adoption: null,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="RealComply annexure to the Supervision Guidelines.pdf"',
      "Cache-Control": "no-store",
      // Never indexed: the token is the only thing protecting it.
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
