"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthContext } from "@/lib/actions/compliance";
import { buildSignoffStatement } from "@/lib/signoff/statement";
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
  // retyped: a3 carries the agency agreement's signing date, a4 the ESP.
  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .in("item_key", ["a3", "a4"]);

  const items = (rows ?? []) as PropertyItem[];
  const a3 = items.find((i) => i.item_key === "a3");
  const a4 = items.find((i) => i.item_key === "a4");
  const a4data = (a4?.data ?? {}) as { espLow?: number; espHigh?: number };

  const statement = buildSignoffStatement({
    agencyName: (agency as { name?: string } | null)?.name ?? "the agency",
    propertyAddress: (property as { address: string }).address,
    agreementDate: a3?.event_date ?? null,
    espLow: a4data.espLow ?? null,
    espHigh: a4data.espHigh ?? null,
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

/** Kills a link that was sent to the wrong place, or is simply stale. */
export async function revokeSignoffLink(requestId: string, propertyId: string): Promise<{ error: string | null }> {
  const { supabase } = await requireAuthContext();

  const { error } = await supabase
    .from("property_signoff_requests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", requestId);

  if (error) {
    return { error: "Couldn't revoke that link." };
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
