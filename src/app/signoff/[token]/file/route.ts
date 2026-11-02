import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { NextResponse } from "next/server";
import { buildAuditPack } from "@/lib/pdf/audit-pack";
import { storeAuditPack } from "@/lib/pdf/audit-pack-store";
import { signoffReviewFor } from "@/lib/data/signoff-review";

// The file the licensee is asked to sign, from the emailed sign-off page
// (Adam, 12 Oct 2026): the audit pack, as the agent downloads it, marked
// "DRAFT - not yet signed off" until the licensee signs.
//
// The token is the only credential, the same as the page: a live link, or
// not found. A final sign-off link only: signoffReviewFor finds nothing for a
// price statement link (b4, 0066), so its token cannot open the file. Built
// with the server's access and scoped to the one listing and agency the
// token names (buildAuditPack keeps every query inside it).
//
// ?download=1 saves it; otherwise it opens in the browser's PDF viewer.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // Saved in the private holding area and opened from there (2 Nov 2026):
  // with every document inside, the pack is too big to send back from here.
  // The link lasts 10 minutes; the copy goes once it has run out (lib/pdf/audit-pack-store.ts).
  const download = new URL(request.url).searchParams.get("download") === "1";
  const url = await storeAuditPack(createServiceClient(), pack, { agencyId: review.agencyId, propertyId: review.propertyId }, { inline: !download });
  const response = NextResponse.redirect(url, 303);
  // Never cached or indexed: the token is the only thing protecting it.
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
