import { NextResponse } from "next/server";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireProfile } from "@/lib/data/current-profile";
import { buildAuditPack } from "@/lib/pdf/audit-pack";
import { storeAuditPack } from "@/lib/pdf/audit-pack-store";
import { endedStateFor } from "@/lib/subscription-end/access";

// The listing's audit pack: every document on the listing inside one PDF
// (Adam, 2 Nov 2026).
//
// Built here with the signed-in person's own access, as before: requireProfile
// establishes the session, and RLS scopes every read to the caller's own
// agency, so a guessed property id returns nothing rather than somebody
// else's file. The finished PDF is then saved in the private holding area and
// the browser downloads it from Storage (lib/pdf/audit-pack-store.ts), because
// a pack with every document inside is too big to send back from here.
//
// The Save as PDF button asks with ?prepare=1 and gets the link back, so it
// can say "Preparing your audit pack" while this runs. Without it, this
// redirects to the file: an old link or bookmark still downloads the pack.
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  // Once a subscription has ended, only the licensee in charge and the
  // account holder may download records (brief of 8 Oct 2026, item 2).
  const ended = await endedStateFor(supabase, profile);
  if (ended && !ended.mayUseRecords) notFound();

  const pack = await buildAuditPack(supabase, id, profile.agency_id, profile.full_name ?? profile.email);
  if (!pack) notFound();

  const url = await storeAuditPack(createServiceClient(), pack, { agencyId: profile.agency_id, propertyId: id });
  if (new URL(request.url).searchParams.get("prepare") === "1") {
    return NextResponse.json({ url, filename: pack.filename }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.redirect(url, 303);
}
