import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { auditPackResponse, buildAuditPack } from "@/lib/pdf/audit-pack";
import { signoffReviewFor } from "@/lib/data/signoff-review";

// The file the licensee is asked to sign, from the emailed sign-off page
// (Adam, 12 Oct 2026): the audit pack, as the agent downloads it, marked
// "DRAFT - not yet signed off" until the licensee signs.
//
// The token is the only credential, the same as the page: a live link, or
// not found. Built with the server's access and scoped to the one listing and
// agency the token names (buildAuditPack keeps every query inside it).
//
// ?download=1 saves it; otherwise it opens in the browser's PDF viewer.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await signoffReviewFor(token);
  if (!review) notFound();

  const pack = await buildAuditPack(
    createServiceClient(),
    review.propertyId,
    review.agencyId,
    review.licenseeName ?? review.sentTo,
  );
  if (!pack) notFound();

  const download = new URL(request.url).searchParams.get("download") === "1";
  const response = auditPackResponse(pack, !download);
  // Never cached or indexed: the token is the only thing protecting it.
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
