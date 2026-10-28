"use server";

import { revalidatePath } from "next/cache";
import { appBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { buildReopenRequestEmail } from "@/lib/email/reopen-request";
import { getItem } from "@/lib/rules/nsw-sales";
import { REOPEN_REASON_MAX } from "@/lib/rules/reopen";
import { STAGE_LABELS, type PropertyStage } from "@/lib/types";

// Asking the licensee in charge to reopen a card on a signed-off file, and
// the licensee declining (Adam, 28 Oct 2026). The database decides who may
// and keeps the request (0100). The licensee says yes by reopening the card
// itself, through reopenCard (lib/actions/compliance.ts).

const REASON_NEEDED = `Say why it needs reopening, in up to ${REOPEN_REASON_MAX} characters.`;

export async function requestReopen(propertyId: string, itemKey: string, reason: string): Promise<{ error: string | null }> {
  const trimmed = reason.trim();
  if (!trimmed || [...trimmed].length > REOPEN_REASON_MAX) return { error: REASON_NEEDED };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to ask." };

  const { error } = await supabase.rpc("request_listing_reopen", {
    p_property_id: propertyId,
    p_item_key: itemKey,
    p_reason: trimmed,
  });
  if (error) return { error: error.code === "P0001" ? error.message : "Couldn't send the request. Try again." };

  await emailLicensee(propertyId, itemKey, trimmed, user.id);
  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard/home");
  return { error: null };
}

export async function declineReopen(requestId: string, propertyId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_listing_reopen", { p_request_id: requestId });
  if (error) return { error: error.code === "P0001" ? error.message : "Couldn't decline the request. Try again." };
  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard/home");
  return { error: null };
}

/**
 * The licensee in charge hears about it by email. A courtesy on top of the
 * request, which is already saved and shows on their Home and on the card,
 * so a failed send is logged and never undoes it. Read with the server's own
 * access: since 0058 an agent can't read the licensee's profile.
 */
async function emailLicensee(propertyId: string, itemKey: string, reason: string, requesterId: string) {
  try {
    const service = createServiceClient();
    const { data: property } = await service
      .from("properties")
      .select("address, agency_id")
      .eq("id", propertyId)
      .maybeSingle();
    const p = property as { address: string; agency_id: string } | null;
    if (!p) return;
    const [{ data: licensees }, { data: requester }] = await Promise.all([
      service
        .from("profiles")
        .select("full_name, email")
        .eq("agency_id", p.agency_id)
        .eq("is_licensee_in_charge", true)
        .is("archived_at", null),
      service.from("profiles").select("full_name").eq("id", requesterId).maybeSingle(),
    ]);
    const item = getItem(itemKey);
    const url = `${appBaseUrl()}/dashboard/${propertyId}${item ? `?stage=${item.stage}` : ""}#card-${itemKey}`;
    for (const l of (licensees ?? []) as Array<{ full_name: string | null; email: string | null }>) {
      if (!l.email) continue;
      const { subject, text, html } = buildReopenRequestEmail({
        licenseeName: l.full_name?.split(" ")[0] ?? null,
        requesterName: (requester as { full_name: string | null } | null)?.full_name?.trim() || "Someone in your office",
        propertyAddress: p.address,
        cardTitle: item?.label ?? itemKey,
        stageLabel: item ? STAGE_LABELS[item.stage as PropertyStage] : "",
        reason,
        url,
      });
      await sendEmail({ to: l.email, subject, text, html });
    }
  } catch (err) {
    console.error("reopen request email failed:", propertyId, err);
  }
}
