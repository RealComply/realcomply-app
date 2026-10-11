"use server";

import { appBaseUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { buildSendBackEmail } from "@/lib/email/send-back";
import { getItem } from "@/lib/rules/nsw-sales";
import { priceStatementByEmail } from "@/lib/rules/price-statement";
import { STAGE_LABELS, type PropertyStage } from "@/lib/types";

// Sending a file back for changes (0062, 0063; Adam, 12 Oct 2026). A flagged
// card is cleared by marking it done as usual (0063), not from here.
//
// THE DATABASE DECIDES. Who may send back (the licensee in charge, or whoever
// holds a live emailed link), what it resets (the outstanding link, "Send to
// licensee", the agent's signature) and what it locks are all in 0062's
// functions, in one transaction. A signed agent signature is locked to every
// signed-in user (0058), which is why none of this can be done from here.

export type SendBackState = { error: string | null; done?: boolean };

export type FlagInput = { item_key: string; note: string; may_be_breach: boolean };


/** Reads and checks the flagged cards from the form. Null when there are none. */
function flagsFrom(formData: FormData): FlagInput[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(formData.get("flags") ?? "[]"));
  } catch {
    return "Something went wrong reading the form. Try again.";
  }
  if (!Array.isArray(parsed)) return "Something went wrong reading the form. Try again.";
  const flags: FlagInput[] = [];
  for (const raw of parsed as Array<Record<string, unknown>>) {
    const key = String(raw?.item_key ?? "").trim();
    const note = String(raw?.note ?? "").trim();
    if (!key || !getItem(key)) return "One of the cards wasn't recognised. Reload the page and try again.";
    if (!note) return `Add a note to "${getItem(key)?.label}" saying what needs changing.`;
    if (note.length > 1000) return "Keep each note under 1,000 characters.";
    flags.push({ item_key: key, note, may_be_breach: raw?.may_be_breach === true });
  }
  if (flags.length === 0) return "Flag at least one card, with a note saying what needs changing.";
  return flags;
}

/** The database's own words when it refuses (0062 raises plain sentences), otherwise a fallback. */
function refusal(message: string | undefined): string {
  return message?.trim() || "Couldn't send the file back. Try again.";
}

/**
 * Tells the listing's agent, by email, what was sent back. Uses the server's
 * own access: an outside licensee has no session, and in the app the agent's
 * address may not be readable to the licensee's session. Never throws.
 *
 * Called only from sendBackWithLink, the token holder's request, so every
 * read here is for a request with no session behind it.
 */
async function emailAgent(propertyId: string, flags: FlagInput[], licenseeName: string | null, replyTo: string | null) {
  try {
    const service = createServiceClient();
    const { data: property } = await service
      .from("properties")
      .select("address, created_by, agency_id")
      .eq("id", propertyId)
      .maybeSingle();
    const p = property as { address: string; created_by: string | null; agency_id: string } | null;
    if (!p?.created_by) return;
    const { data: agent } = await service
      .from("profiles")
      .select("full_name, email")
      .eq("id", p.created_by)
      .eq("agency_id", p.agency_id)
      .maybeSingle();
    const a = agent as { full_name: string | null; email: string | null } | null;
    if (!a?.email) return;

    // Whether b4 goes by email in this office (0066), asked only when b4 is
    // one of the cards. Then nobody signed in can mark it done, and the email
    // says to send the price statement again instead (review, 11 Oct 2026).
    // The same rule as the listing page, on the same rows; agency_people()
    // needs a session, so this reads them directly. A failed read keeps the
    // usual words, as before.
    let byEmail = false;
    if (flags.some((f) => f.item_key === "b4")) {
      const { data: people, error: peopleError } = await service
        .from("profiles")
        .select("is_licensee_in_charge, archived_at")
        .eq("agency_id", p.agency_id)
        .eq("is_licensee_in_charge", true);
      if (!peopleError && people) {
        byEmail = priceStatementByEmail(people as Array<{ is_licensee_in_charge: boolean; archived_at: string | null }>);
      }
    }

    const { subject, text, html } = buildSendBackEmail({
      agentName: a.full_name?.split(" ")[0] ?? null,
      licenseeName,
      propertyAddress: p.address,
      url: `${appBaseUrl()}/dashboard/${propertyId}`,
      cards: flags.map((f) => {
        const item = getItem(f.item_key);
        return {
          itemKey: f.item_key,
          label: item?.label ?? f.item_key,
          stageLabel: item ? STAGE_LABELS[item.stage as PropertyStage] : "",
          note: f.note,
          mayBeBreach: f.may_be_breach,
        };
      }),
      priceStatementByEmail: byEmail,
    });
    await sendEmail({ to: a.email, subject, text, html, ...(replyTo ? { replyTo } : {}) });
  } catch (err) {
    console.error("send-back email failed:", propertyId, err);
  }
}

/** The licensee with the emailed link and no account. The token is the credential. */
export async function sendBackWithLink(token: string, _prev: SendBackState, formData: FormData): Promise<SendBackState> {
  const flags = flagsFrom(formData);
  if (typeof flags === "string") return { error: flags };

  // Read before the send-back revokes it: which listing, and who it went to.
  // The final sign-off link only: a price statement link (b4, 0066) cannot
  // send the file back, and send_back_by_token refuses one too.
  const service = createServiceClient();
  const { data: request } = await service
    .from("property_signoff_requests")
    .select("property_id, sent_to, agency_id")
    .eq("token", token)
    .eq("item_key", "sign_licensee")
    .is("signed_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const r = request as { property_id: string; sent_to: string; agency_id: string } | null;
  if (!r) return { error: "This link is no longer valid." };

  // Through the anon client, so the database checks the token itself.
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_back_by_token", { p_token: token, p_items: flags });
  if (error) return { error: refusal(error.message) };

  const { data: agency } = await service.from("agencies").select("licensee_name").eq("id", r.agency_id).maybeSingle();
  await emailAgent(r.property_id, flags, (agency as { licensee_name?: string | null } | null)?.licensee_name ?? null, r.sent_to);
  return { error: null, done: true };
}
