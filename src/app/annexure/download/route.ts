import { buildSgAnnexurePdf } from "@/lib/pdf/sg-annexure";

// The annexure for an agent on their own plan to give their licensee in charge
// (CORRECTION, Adam, 14 Oct 2026, restoring the 22 Sep 2026 rule: on an agent
// plan RealComply never contacts the agent's licensee). Linked from the
// welcome email, so it opens signed out.
//
// The same annexure as the signing page's PDF, with the Agency, Licence number
// and Effective date lines left blank for the licensee to fill in, and nothing
// that names the agent or their office: the address is the same for everyone.

export const dynamic = "force-dynamic";

export async function GET() {
  const pdf = await buildSgAnnexurePdf({
    agencyName: "",
    licenceNumber: null,
    effectiveDate: null,
    logo: null,
    adoption: null,
  });

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="RealComply annexure to the Supervision Guidelines.pdf"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
