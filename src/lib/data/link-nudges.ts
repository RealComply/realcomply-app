import type { SupabaseClient } from "@supabase/supabase-js";
import { getItem } from "@/lib/rules/nsw-sales";
import {
  nudgeText,
  sentLine,
  signoffLinksToNudge,
  type AnnexureLinkRow,
  type SignoffLinkRow,
} from "@/lib/links/delivery";

// Email that gets through (Adam, 2 Nov 2026; 0107): after 2 business days
// unopened, a nudge on Home as well as on the card. See lib/links/delivery.ts.

export type SignoffNudge = {
  requestId: string;
  propertyId: string;
  address: string;
  text: string;
  sentLine: string | null;
  href: string;
};

/**
 * The file sign-off links this person sent that nobody has opened in 2
 * business days. On the Home of whoever sent it: they are the one who can copy
 * it and send it themselves. Nothing (rather than an error) before 0107 has
 * run or if the read fails: Home must still load.
 */
export async function unopenedSignoffLinksFor(
  supabase: SupabaseClient,
  profile: { id: string; agency_id: string },
  now: Date = new Date(),
): Promise<SignoffNudge[]> {
  try {
    const { data, error } = await supabase
      .from("property_signoff_requests")
      .select("id, property_id, created_at, email_sent_at, opened_at, signed_at, expires_at")
      .eq("created_by", profile.id)
      .eq("item_key", "sign_licensee")
      .is("revoked_at", null);
    if (error || !data) return [];
    const due = signoffLinksToNudge(data as SignoffLinkRow[], now);
    if (due.length === 0) return [];
    const [{ data: props }, { data: agency }] = await Promise.all([
      supabase.from("properties").select("id, address").in("id", due.map((r) => r.property_id)),
      supabase.from("agencies").select("licensee_name").eq("id", profile.agency_id).maybeSingle(),
    ]);
    const addressOf = new Map(((props ?? []) as Array<{ id: string; address: string }>).map((p) => [p.id, p.address]));
    const name = ((agency as { licensee_name?: string | null } | null)?.licensee_name ?? "").trim() || "Your licensee";
    const stage = getItem("sign_licensee")?.stage;
    return due
      .filter((r) => addressOf.has(r.property_id))
      .map((r) => ({
        requestId: r.id,
        propertyId: r.property_id,
        address: addressOf.get(r.property_id) as string,
        text: nudgeText("signoff", name),
        sentLine: sentLine({ emailSentAt: r.email_sent_at, createdAt: r.created_at, openedAt: r.opened_at, doneAt: r.signed_at }),
        href: `/dashboard/${r.property_id}${stage ? `?stage=${stage}` : ""}#card-sign_licensee`,
      }));
  } catch {
    return [];
  }
}

/**
 * The office's annexure link, for whoever set the office up or runs it (the
 * database decides: 0107's office_annexure_link_status). Read it with
 * annexureLinkStatus(). No Copy link (option 2). Null before 0107 has run or
 * if the read fails: Home must still load.
 */
export async function annexureLinkFor(supabase: SupabaseClient): Promise<AnnexureLinkRow | null> {
  try {
    const { data, error } = await supabase.rpc("office_annexure_link_status");
    if (error || !Array.isArray(data)) return null;
    return (data[0] as AnnexureLinkRow | undefined) ?? null;
  } catch {
    return null;
  }
}
