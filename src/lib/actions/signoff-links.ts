"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthContext } from "@/lib/actions/compliance";
import { buildSignoffStatement } from "@/lib/signoff/statement";
import { effectiveEsp } from "@/lib/data/effective-esp";
import { liveLink, signoffLinksFor } from "@/lib/data/signoff-links";
import type { PropertyItem } from "@/lib/types";

// Issuing and revoking licensee sign-off links. See
// RealComply-licensee-signoff-link.md and 0014_licensee_signoff_links.sql.

// Kept in step with the same constant in the finalised-record page. Stamped on
// each request so a signature is traceable to the ruleset in force when it was
// given, per the audit-trail principle in the website IA doc.
const RULESET_VERSION = "NSW Sales Ruleset 2026.2";

export type IssueResult = {
  error: string | null;
  token?: string;
  sentTo?: string;
};

/**
 * Creates a sign-off link for a property.
 *
 * Deliberately does NOT send an email. SES is still sandboxed and rejects any
 * recipient not verified in the AWS console, which every external licensee is
 * — so an automatic send would fail silently for exactly the people this
 * feature exists for. The agent copies the link and sends it themselves, which
 * works today and arrives from someone the licensee actually knows. Wire the
 * automatic send alongside this once Resend is live; do not replace the copy
 * path with it.
 */
export async function issueSignoffLink(propertyId: string): Promise<IssueResult> {
  const { supabase, profile } = await requireAuthContext();

  // An outstanding link is handed back rather than replaced.
  //
  // The button that calls this is the only way an agent can retrieve a link
  // they have already sent, so pressing it twice is the normal thing to do,
  // not a mistake. Minting a second token each time would leave several live
  // links for one file, all valid, and a licensee signing the older one after
  // the agent has chased them with a newer one — two versions of the same
  // request, both real. One outstanding link per property is the rule; to
  // change where it goes, withdraw it and issue another.
  const outstanding = liveLink(await signoffLinksFor(supabase, propertyId));
  if (outstanding) {
    return { error: null, token: outstanding.token, sentTo: outstanding.sentTo };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, agency_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) {
    return { error: "Couldn't find that property." };
  }

  const { data: agency } = await supabase
    .from("agencies")
    .select("name, licensee_email")
    .eq("id", (property as { agency_id: string }).agency_id)
    .maybeSingle();

  const licenseeEmail = (agency as { licensee_email?: string | null } | null)?.licensee_email ?? null;
  if (!licenseeEmail) {
    return {
      error:
        "No licensee email on file. Add the licensee in charge's email address in Team settings, then try again.",
    };
  }

  // The two facts the statement ties to, read from the file rather than
  // retyped. a3 carries the agency agreement's signing date; the ESP comes
  // from effectiveEsp below rather than from a4, because a4 holds the figure
  // set at listing and a file whose price was formally revised has moved on.
  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", "a3");

  const items = (rows ?? []) as PropertyItem[];
  const a3 = items.find((i) => i.item_key === "a3");
  // The ESP a licensee is asked to sign against has to be the one currently
  // on foot. Showing the figure from listing set-up on a file where the price
  // was formally revised puts a superseded number above a signature.
  const esp = await effectiveEsp(supabase, propertyId);

  const statement = buildSignoffStatement({
    agencyName: (agency as { name?: string } | null)?.name ?? "the agency",
    propertyAddress: (property as { address: string }).address,
    agreementDate: a3?.event_date ?? null,
    espLow: esp.low,
    espHigh: esp.high,
    rulesetVersion: RULESET_VERSION,
    issuedOn: new Date().toISOString(),
  });

  const { data: inserted, error } = await supabase
    .from("property_signoff_requests")
    .insert({
      agency_id: (property as { agency_id: string }).agency_id,
      property_id: propertyId,
      sent_to: licenseeEmail,
      statement,
      ruleset_version: RULESET_VERSION,
      created_by: profile.id,
    })
    .select("token")
    .single();

  if (error || !inserted) {
    return { error: "Couldn't create the sign-off link. Try again." };
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null, token: (inserted as { token: string }).token, sentTo: licenseeEmail };
}

/**
 * Kills a link that was sent to the wrong place, or is simply stale.
 *
 * Refuses to touch one that has already been signed. Revoking a signature
 * would not undo it — submit_signoff has already completed the file's
 * sign_licensee item — it would only produce a record that reads as though the
 * request was withdrawn before it was signed, which is a false account of what
 * a licensee did. A signature stands; a pending request can be withdrawn.
 */
export async function revokeSignoffLink(requestId: string, propertyId: string): Promise<{ error: string | null }> {
  const { supabase } = await requireAuthContext();

  const { data, error } = await supabase
    .from("property_signoff_requests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", requestId)
    .is("signed_at", null)
    .select("id");

  if (error) {
    return { error: "Couldn't withdraw that link." };
  }
  if (!data || data.length === 0) {
    return { error: "That link has already been signed, so it can't be withdrawn." };
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

export type PublicSignoffRequest = {
  request_id: string;
  statement: string;
  ruleset_version: string | null;
  property_address: string;
  agency_name: string;
  expires_at: string;
};

/**
 * Reads a request by token, for the public signing page. Goes through the
 * SECURITY DEFINER RPC rather than the table, which has no anon policy at all
 * — see the migration for why a token-keyed anon SELECT policy would be the
 * same as publishing the table.
 */
export async function getSignoffRequest(token: string): Promise<PublicSignoffRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_signoff_request", { p_token: token });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  return (Array.isArray(data) ? data[0] : data) as PublicSignoffRequest;
}

/**
 * Records the signature. The RPC also completes the property's sign_licensee
 * item in the same transaction, so the agent's file updates the moment this
 * returns — no second step, and no window in which a licensee has signed
 * something the file still shows as outstanding.
 */
export async function submitSignoff(
  _prev: { error: string | null; signed: boolean },
  formData: FormData,
): Promise<{ error: string | null; signed: boolean }> {
  const token = String(formData.get("token") ?? "");
  const typedName = String(formData.get("typedName") ?? "").trim();

  if (!typedName) {
    return { error: "Type your full name to sign.", signed: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_signoff", {
    p_token: token,
    p_typed_name: typedName,
  });

  if (error || data !== true) {
    return {
      error: "This link is no longer valid. It may have expired, been withdrawn, or already been signed.",
      signed: false,
    };
  }

  return { error: null, signed: true };
}
