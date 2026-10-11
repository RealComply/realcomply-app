import { createServiceClient } from "@/lib/supabase/service";
import { reviewCardsFor, type ReviewCard } from "@/lib/data/send-backs";
import type { Property, PropertyItem } from "@/lib/types";

// What the emailed sign-off page needs to let the licensee review the file
// (Adam, 12 Oct 2026). The token is the only credential, exactly as for the
// statement and the signature (0014): a live link, not signed, revoked or
// expired. Anything else returns null and the page shows its one "no longer
// valid" state.
//
// Server's own access, because the licensee has no session. Every read below
// is scoped to the one listing and agency the token names.
//
// The final sign-off link only (0065, 12 Oct 2026). A price statement link
// asks the licensee to approve one line before the listing is advertised: it
// is not a review of the file, cannot send it back, and must not open the
// audit pack at /signoff/[token]/file. With the filter below a b4 token finds
// nothing here, and every one of those paths shows "not found".

export type SignoffReview = {
  propertyId: string;
  agencyId: string;
  sentTo: string;
  licenseeName: string | null;
  agentName: string | null;
  cards: ReviewCard[];
};

export async function signoffReviewFor(token: string): Promise<SignoffReview | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const supabase = createServiceClient();

  const { data: request } = await supabase
    .from("property_signoff_requests")
    .select("property_id, agency_id, sent_to")
    .eq("token", token)
    .eq("item_key", "sign_licensee")
    .is("signed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const r = request as { property_id: string; agency_id: string; sent_to: string } | null;
  if (!r) return null;

  const [{ data: property }, { data: rows }, { data: agency }] = await Promise.all([
    supabase.from("properties").select("*").eq("id", r.property_id).eq("agency_id", r.agency_id).maybeSingle(),
    supabase.from("property_items").select("*").eq("property_id", r.property_id).eq("agency_id", r.agency_id),
    supabase.from("agencies").select("licensee_name").eq("id", r.agency_id).maybeSingle(),
  ]);
  if (!property) return null;
  const p = property as Property;

  let agentName: string | null = null;
  if (p.created_by) {
    const { data: agent } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", p.created_by)
      .eq("agency_id", r.agency_id)
      .maybeSingle();
    agentName = (agent as { full_name?: string | null } | null)?.full_name?.split(" ")[0] ?? null;
  }

  return {
    propertyId: r.property_id,
    agencyId: r.agency_id,
    sentTo: r.sent_to,
    licenseeName: (agency as { licensee_name?: string | null } | null)?.licensee_name ?? null,
    agentName,
    cards: await reviewCardsFor(supabase, p, (rows ?? []) as PropertyItem[]),
  };
}
