"use server";

import { appBaseUrl } from "@/lib/site-url";
import { createServiceClient } from "@/lib/supabase/service";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthContext, sendToLicensee } from "@/lib/actions/compliance";
import { buildSignoffStatement } from "@/lib/signoff/statement";
import { effectiveEsp } from "@/lib/data/effective-esp";
import { espGateFor } from "@/lib/data/esp-gate";
import { agencyPeople } from "@/lib/data/people";
import { liveLink, signoffLinksFor } from "@/lib/data/signoff-links";
import { sendEmail } from "@/lib/email/send";
import { buildSignoffRequestEmail } from "@/lib/email/signoff-request";
import { buildPriceStatementRequestEmail } from "@/lib/email/price-statement-request";
import { STAGE_GATE_MESSAGE } from "@/lib/rules/esp-reasoning-gate";
import {
  PRICE_STATEMENT_MAX,
  normalisePriceStatement,
  priceRequestStale,
  priceStatementByEmail,
} from "@/lib/rules/price-statement";
import { formatAuDate, formatAuTimestamp } from "@/lib/format-date";
import type { PropertyItem } from "@/lib/types";


// Issuing and revoking licensee sign-off links. See
// RealComply-licensee-signoff-link.md and 0014_licensee_signoff_links.sql.
//
// And, since 0065 (Adam, 12 Oct 2026), the price statement link: where the
// office's licensee in charge does not use RealComply, b4 goes to them by
// email and they approve the exact words there. Same table, same token rules,
// a different item_key. Both live in this file so tokenFor stays the one
// place the server reads a token with its own access. Every final sign-off
// path below names "sign_licensee", so a b4 request is never handed back,
// resent or withdrawn as the final link.

// Kept in step with the same constant in the finalised-record page. Stamped on
// each request so a signature is traceable to the ruleset in force when it was
// given, per the audit-trail principle in the website IA doc.
const RULESET_VERSION = "NSW Sales Ruleset 2026.2";

// No token in the result (Adam, 9 Oct 2026): the link goes only to the
// licensee, by email, so nobody else can open it and sign in their name.
export type IssueResult = {
  error: string | null;
  sentTo?: string;
  /** Whether the email actually went. False means the link exists and was not delivered; send again. */
  emailed?: boolean;
};

/**
 * The link's token, read with the server's own access. Signed-in people
 * cannot read it (0058). Only called after the caller's own read of the
 * request has succeeded, so the database rules have already decided they
 * may act on this listing.
 */
async function tokenFor(requestId: string): Promise<string | null> {
  const { data } = await createServiceClient()
    .from("property_signoff_requests")
    .select("token")
    .eq("id", requestId)
    .maybeSingle();
  return (data as { token?: string } | null)?.token ?? null;
}

type Client = Awaited<ReturnType<typeof requireAuthContext>>["supabase"];

/**
 * Sends the link, and records honestly whether it went.
 *
 * Separated from issuing so the resend path and the first send are the same
 * code. Never throws: a delivery failure must leave a usable link behind, not
 * lose the request.
 *
 * One delivery for both kinds of link (12 Oct 2026): the caller builds the
 * email around the URL. A token that cannot be read is recorded as a failed
 * attempt like any other. It used to return before recording anything, and a
 * request with no attempts reads on the panel as sent.
 */
async function deliverLinkEmail(
  supabase: Client,
  args: {
    requestId: string;
    sentTo: string;
    agentEmail: string | null;
    priorAttempts: number;
    build: (url: string) => { subject: string; text: string; html: string };
  },
): Promise<boolean> {
  const token = await tokenFor(args.requestId);
  let ok = false;
  if (token) {
    // Every licensee, with an account or not, gets the sign-off page: the
    // file on the page, sign below it, or send it back (Adam, 12 Oct 2026).
    // On an agent's listing the app has no Licensee signature card to land on.
    // A price statement link opens the same page, which shows the statement.
    const { subject, text, html } = args.build(`${appBaseUrl()}/signoff/${token}`);

    // Reply-to is the agent, not the sending address. See the note in
    // email/signoff-request.ts — this is the single most useful thing on a
    // message that is, structurally, indistinguishable from a phishing attempt.
    ok = await sendEmail({
      to: args.sentTo,
      subject,
      text,
      html,
      ...(args.agentEmail ? { replyTo: args.agentEmail } : {}),
    });
  }

  await supabase
    .from("property_signoff_requests")
    .update({
      email_attempts: args.priorAttempts + 1,
      email_sent_at: ok ? new Date().toISOString() : null,
      email_error: ok
        ? null
        : "The email could not be sent. Try sending it again.",
    })
    .eq("id", args.requestId);

  return ok;
}

/**
 * Completes the file's "Send to licensee" step once the link has actually
 * gone (10 Oct 2026). Only the separate "Mark sent to licensee" button ever
 * did it, so a file whose link had been emailed, and even signed, kept that
 * step outstanding and stayed amber on Home and in the sidebar. The step
 * records that the file went to the licensee, and this email is that event.
 * Left alone when it is already done, so the first send keeps its time.
 */
async function markSentToLicensee(
  supabase: Client,
  propertyId: string,
): Promise<void> {
  const { data } = await supabase
    .from("property_items")
    .select("status")
    .eq("property_id", propertyId)
    .eq("item_key", "send_licensee")
    .maybeSingle();
  if ((data as { status?: string } | null)?.status === "done") return;
  await sendToLicensee(propertyId);
}

/**
 * Creates a sign-off link for a property AND emails it to the licensee.
 *
 * IT USED TO DELIBERATELY NOT SEND, and the reason is worth keeping because it
 * was right at the time and wrong by the time anyone re-read it: SES was in
 * the sandbox and rejected any recipient not verified in the AWS console —
 * which every external licensee is, by definition. An automatic send would
 * have failed silently for exactly the people this feature exists for.
 *
 * **SES was granted production access on 26 August 2026.** The note recording
 * the copy-only decision was written on 5 September and carried the dead
 * constraint forward, so for three weeks the product asked agents to copy a
 * link, open their email, paste it, and write an explanation — for no reason.
 * Adam, 17 Sep 2026: "We should do all that for them."
 *
 * Worth generalising: a decision recorded with its reason has to be re-read
 * against whether the reason still holds. This one outlived its cause by
 * three weeks purely because the note was confidently written.
 *
 * REVERSAL (Adam, 9 Oct 2026). The copy path was kept as a second option
 * ("some agents will want to send it themselves"). It is gone: an agent
 * holding the link could open it and sign as the licensee. The link now goes
 * only by email to the agency's licensee email, which only the licensee can
 * change (0058).
 */
export async function issueSignoffLink(propertyId: string): Promise<IssueResult> {
  const { supabase, profile, access } = await requireAuthContext();

  // An outstanding link is handed back rather than replaced.
  //
  // The button that calls this is the only way an agent can retrieve a link
  // they have already sent, so pressing it twice is the normal thing to do,
  // not a mistake. Minting a second token each time would leave several live
  // links for one file, all valid, and a licensee signing the older one after
  // the agent has chased them with a newer one — two versions of the same
  // request, both real. One outstanding link per property is the rule; to
  // change where it goes, withdraw it and issue another.
  const outstanding = liveLink(await signoffLinksFor(supabase, propertyId), "sign_licensee");
  if (outstanding) {
    return {
      error: null,
      sentTo: outstanding.sentTo,
      emailed: outstanding.emailSentAt !== null,
    };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, agency_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) {
    return { error: "Couldn't find that property." };
  }

  // After the licensee sent the file back (0062): every flagged card fixed,
  // then the agent signs again, before it goes back to them. The database
  // refuses the link while a card is open; this says why in plain words.
  const [{ data: openFlags }, { data: sendBacks }, { data: agentSig }] = await Promise.all([
    supabase.from("listing_send_back_items").select("id").eq("property_id", propertyId).is("cleared_at", null).limit(1),
    supabase.from("listing_send_backs").select("id").eq("property_id", propertyId).limit(1),
    supabase.from("property_items").select("status").eq("property_id", propertyId).eq("item_key", "sign_agent").maybeSingle(),
  ]);
  if ((openFlags ?? []).length > 0) {
    return { error: "Some cards your licensee sent back aren't done yet. Fix them and mark them done first." };
  }
  if ((sendBacks ?? []).length > 0 && (agentSig as { status?: string } | null)?.status !== "done") {
    return { error: "Sign the file again (Agent signature, above) before sending it back to your licensee." };
  }

  const { data: agency } = await supabase
    .from("agencies")
    .select("name, licensee_email, licensee_name")
    .eq("id", (property as { agency_id: string }).agency_id)
    .maybeSingle();

  const licenseeEmail = (agency as { licensee_email?: string | null } | null)?.licensee_email ?? null;
  if (!licenseeEmail) {
    // Only the licensee can add it (0058), and Team is the licensee's page, so
    // an agent sent there met a page that was not found (10 Oct 2026). They
    // are told who to ask instead. The usual cause is a licensee who answered
    // "Yes, that's me" at signup, where the form does not ask for the email.
    return {
      error: access.actsAsLicensee
        ? "No licensee email on file. Add the licensee in charge's email address in Team settings, then try again."
        : "Your licensee in charge hasn't added their email address yet. Ask them to add it in Team settings, then try again.",
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
    licenseeName: (agency as { licensee_name?: string | null } | null)?.licensee_name ?? null,
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
      // Said outright since 0065, though the column defaults to it.
      item_key: "sign_licensee",
      sent_to: licenseeEmail,
      statement,
      ruleset_version: RULESET_VERSION,
      created_by: profile.id,
    })
    .select("id, expires_at")
    .single();

  if (error || !inserted) {
    return { error: "Couldn't create the sign-off link. Try again." };
  }

  const row = inserted as { id: string; expires_at: string };

  const emailed = await deliverLinkEmail(supabase, {
    requestId: row.id,
    sentTo: licenseeEmail,
    agentEmail: (profile as { email?: string | null }).email ?? null,
    priorAttempts: 0,
    build: (url) =>
      buildSignoffRequestEmail({
        agentName: (profile as { full_name?: string | null }).full_name || "Your agent",
        agencyName: (agency as { name?: string } | null)?.name ?? "the agency",
        propertyAddress: (property as { address: string }).address,
        url,
        expiresAt: formatAuDate(row.expires_at.slice(0, 10)),
        agreementDate: a3?.event_date ? formatAuDate(a3.event_date.slice(0, 10)) : null,
        espLow: esp.low,
        espHigh: esp.high,
      }),
  });

  if (emailed) await markSentToLicensee(supabase, propertyId);

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null, sentTo: licenseeEmail, emailed };
}

/**
 * Sends an existing link again — because the licensee deleted it, or it went
 * to spam, or the agent chased them and wants a fresh copy in their inbox.
 *
 * Deliberately re-sends the SAME token rather than minting a new one. Two live
 * links for one file means a licensee can sign the older one after the agent
 * has chased them with a newer one, which produces two real requests for the
 * same signature. To change where it goes, withdraw and issue again.
 */
export async function resendSignoffLink(propertyId: string): Promise<IssueResult> {
  const { supabase, profile } = await requireAuthContext();

  const outstanding = liveLink(await signoffLinksFor(supabase, propertyId), "sign_licensee");
  if (!outstanding) {
    return { error: "There's no outstanding link to resend. Create one first." };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, agency_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) return { error: "Couldn't find that property." };

  const { data: agency } = await supabase
    .from("agencies")
    .select("name")
    .eq("id", (property as { agency_id: string }).agency_id)
    .maybeSingle();

  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", "a3");

  const a3 = ((rows ?? []) as PropertyItem[]).find((i) => i.item_key === "a3");
  const esp = await effectiveEsp(supabase, propertyId);

  const emailed = await deliverLinkEmail(supabase, {
    requestId: outstanding.id,
    sentTo: outstanding.sentTo,
    agentEmail: (profile as { email?: string | null }).email ?? null,
    priorAttempts: outstanding.emailAttempts,
    build: (url) =>
      buildSignoffRequestEmail({
        agentName: (profile as { full_name?: string | null }).full_name || "Your agent",
        agencyName: (agency as { name?: string } | null)?.name ?? "the agency",
        propertyAddress: (property as { address: string }).address,
        url,
        expiresAt: formatAuDate(outstanding.expiresAt.slice(0, 10)),
        agreementDate: a3?.event_date ? formatAuDate(a3.event_date.slice(0, 10)) : null,
        espLow: esp.low,
        espHigh: esp.high,
      }),
  });

  // The first send failed and this one went, so the file has now been sent.
  if (emailed) await markSentToLicensee(supabase, propertyId);

  revalidatePath(`/dashboard/${propertyId}`);
  return {
    error: emailed ? null : "Couldn't send that email. Try again in a moment.",
    sentTo: outstanding.sentTo,
    emailed,
  };
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

  // This listing's final sign-off link only (12 Oct 2026). A price statement
  // request is withdrawn from its own card (withdrawPriceStatementLink).
  const { data, error } = await supabase
    .from("property_signoff_requests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("property_id", propertyId)
    .eq("item_key", "sign_licensee")
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
  /** What the link is for (0065): the final sign-off, or the price statement. */
  item_key: "sign_licensee" | "b4";
  statement: string;
  /** b4 only: the exact words being approved, fixed when the request was made. */
  price_statement: string | null;
  /** b4 only: the estimated selling price shown with it. */
  esp_low: number | null;
  esp_high: number | null;
  ruleset_version: string | null;
  property_address: string;
  agency_name: string;
  /**
   * The agent who asked. Null on rows whose author has since left the agency,
   * or on requests issued before 0048 — the page falls back to the agency name
   * rather than showing a gap.
   */
  requested_by_name: string | null;
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
  // v3 (0065): it says what the link is for, and carries the price statement.
  // A function's return type cannot be changed in place, which is why there
  // is a v2 and now a v3 rather than one replaced function (see 0048). v3
  // also hides a price statement request the licensee can no longer approve,
  // because the ESP or the ESP reasoning changed after it was sent.
  const { data, error } = await supabase.rpc("get_signoff_request_v3", { p_token: token });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as PublicSignoffRequest;
  // Anything but a price statement request reads as the final sign-off, which
  // is what every link was before 0065.
  return { ...row, item_key: row.item_key === "b4" ? "b4" : "sign_licensee" };
}

/**
 * Records the signature. The RPC also completes the property's sign_licensee
 * item in the same transaction, so the agent's file updates the moment this
 * returns — no second step, and no window in which a licensee has signed
 * something the file still shows as outstanding.
 *
 * For a price statement link the same RPC completes b4 instead (0065). Which
 * one is decided by the database from the request the token names. The
 * hidden "kind" field below only picks the words on an error.
 */
export async function submitSignoff(
  _prev: { error: string | null; signed: boolean },
  formData: FormData,
): Promise<{ error: string | null; signed: boolean }> {
  const token = String(formData.get("token") ?? "");
  const typedName = String(formData.get("typedName") ?? "").trim();
  const approving = formData.get("kind") === "b4";

  if (!typedName) {
    return { error: approving ? "Type your full name to approve." : "Type your full name to sign.", signed: false };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_signoff", {
    p_token: token,
    p_typed_name: typedName,
  });

  if (error || data !== true) {
    return {
      error: approving
        ? "This link is no longer valid. It may have expired, been withdrawn, or already been approved."
        : "This link is no longer valid. It may have expired, been withdrawn, or already been signed.",
      signed: false,
    };
  }

  return { error: null, signed: true };
}

// ── The price statement (b4) by email ──────────────────────────────────────
//
// Adam, 12 Oct 2026, option (a). Where nobody in the office is an active
// licensee in charge on RealComply, b4 is sent to agencies.licensee_email and
// the licensee approves the exact words from the email. Anyone who can see
// the listing can send it, send it again, change the wording or withdraw it,
// assistants included: none of that approves anything. Only the person
// reading the email can.
//
// The rule is checked three times: the page decides what to show, these
// actions work it out again from their own reads, and the database refuses
// (0065). The database also sets who it goes to, builds the statement the
// licensee reads, and fixes the ESP they are shown. The app sends only the
// listing, the kind and the words.
//
// Never marks "Send to licensee" done. That step is the final file going to
// the licensee, and this is not it.

export type PriceLinkState = {
  error: string | null;
  sentTo?: string;
  /** False when the request was saved and the email did not go. */
  emailed?: boolean;
};

/** The database's own sentence when one of its rules refuses (raised in 0065's guard), otherwise null. */
function databaseRefusal(error: { code?: string; message?: string } | null): string | null {
  if (!error || error.code !== "P0001") return null;
  return error.message?.trim() || null;
}

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function issuePriceStatementLink(
  propertyId: string,
  _prev: PriceLinkState,
  formData: FormData,
): Promise<PriceLinkState> {
  const { supabase, profile, access } = await requireAuthContext();

  const priceStatement = normalisePriceStatement(formData.get("priceStatement"));
  if (!priceStatement) {
    return { error: `Type the price statement, up to ${PRICE_STATEMENT_MAX} characters.` };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, agency_id, test_mode")
    .eq("id", propertyId)
    .maybeSingle();
  const p = property as { id: string; address: string; agency_id: string; test_mode: boolean } | null;
  if (!p) return { error: "Couldn't find that listing." };

  if (p.test_mode) {
    return { error: "This is a practice listing, so nothing is sent to your licensee." };
  }

  if (!priceStatementByEmail(await agencyPeople(supabase))) {
    return { error: "Your licensee in charge uses RealComply, so they approve the price statement in the app." };
  }

  const { data: b4 } = await supabase
    .from("property_items")
    .select("status")
    .eq("property_id", propertyId)
    .eq("item_key", "b4")
    .maybeSingle();
  if ((b4 as { status?: string } | null)?.status === "done") {
    return { error: "The price statement on this listing is already approved." };
  }

  // The same gate as marking b4 done in the app (Adam, 2 Oct 2026): nothing
  // in Pre-market is completed before the ESP reasoning is.
  const gate = await espGateFor(supabase, propertyId);
  if (!gate.complete) return { error: STAGE_GATE_MESSAGE };

  // One request out at a time, handed back rather than replaced, for the
  // same reason as the final link: two live requests is two versions of one
  // approval. To change the words, withdraw it and send a new one.
  const outstanding = liveLink(await signoffLinksFor(supabase, propertyId), "b4");
  if (outstanding) {
    return { error: null, sentTo: outstanding.sentTo, emailed: outstanding.emailSentAt !== null };
  }

  const { data: agency } = await supabase
    .from("agencies")
    .select("name, licensee_email")
    .eq("id", p.agency_id)
    .maybeSingle();
  const a = agency as { name?: string | null; licensee_email?: string | null } | null;
  if (!a?.licensee_email?.trim()) {
    // On an agent's own plan the agent can add it in Team. In an office whose
    // founder answered "No, someone else", nobody signed in can see Team, so
    // support adds it (Adam's default, 12 Oct 2026).
    return {
      error: access.actsAsLicensee
        ? "Add your licensee in charge's email in Team settings first."
        : "There's no email on file for your licensee in charge. Contact RealComply support to add it.",
    };
  }

  // Only what the database cannot work out for itself. It sets the recipient,
  // the token and expiry, the ESP shown and the statement read (0065), and
  // refuses in a plain sentence when one of its rules says no.
  const { data: inserted, error } = await supabase
    .from("property_signoff_requests")
    .insert({
      agency_id: p.agency_id,
      property_id: propertyId,
      item_key: "b4",
      price_statement: priceStatement,
      ruleset_version: RULESET_VERSION,
    })
    .select("id, expires_at, sent_to, price_statement, esp_low, esp_high")
    .single();

  if (error || !inserted) {
    return { error: databaseRefusal(error) ?? "Couldn't send that. Try again in a moment." };
  }

  const row = inserted as {
    id: string;
    expires_at: string;
    sent_to: string;
    price_statement: string | null;
    esp_low: number | string | null;
    esp_high: number | string | null;
  };

  const emailed = await deliverLinkEmail(supabase, {
    requestId: row.id,
    sentTo: row.sent_to,
    agentEmail: (profile as { email?: string | null }).email ?? null,
    priorAttempts: 0,
    build: (url) =>
      buildPriceStatementRequestEmail({
        agentName: (profile as { full_name?: string | null }).full_name || "Your agent",
        agencyName: a.name ?? "the agency",
        propertyAddress: p.address,
        url,
        expiresAt: formatAuTimestamp(row.expires_at),
        priceStatement: row.price_statement ?? priceStatement,
        espLow: toNumber(row.esp_low),
        espHigh: toNumber(row.esp_high),
      }),
  });

  revalidatePath(`/dashboard/${propertyId}`);
  if (!emailed) {
    return {
      error: "The request was saved but the email couldn't be sent. Press Send again in a moment.",
      sentTo: row.sent_to,
      emailed: false,
    };
  }
  return { error: null, sentTo: row.sent_to, emailed: true };
}

/**
 * Sends the price statement request again, with the same token. The email is
 * built only from what the request fixed when it was made (the words, the
 * ESP shown and the expiry), so the licensee gets the same request again,
 * not a new one.
 */
export async function resendPriceStatementLink(propertyId: string): Promise<PriceLinkState> {
  const { supabase, profile } = await requireAuthContext();

  const outstanding = liveLink(await signoffLinksFor(supabase, propertyId), "b4");
  if (!outstanding || !outstanding.priceStatement) {
    return { error: "There's no request waiting to send again. Send a new one." };
  }

  const [{ data: property }, { data: rows }] = await Promise.all([
    supabase.from("properties").select("address, agency_id").eq("id", propertyId).maybeSingle(),
    supabase
      .from("property_items")
      .select("item_key, status, data")
      .eq("property_id", propertyId)
      .in("item_key", ["a4", "d3", "a4c"]),
  ]);
  const p = property as { address: string; agency_id: string } | null;
  if (!p) return { error: "Couldn't find that listing." };

  // A request the licensee can no longer approve is not worth sending again:
  // the link would open on "no longer valid".
  const items = Object.fromEntries(
    ((rows ?? []) as Array<{ item_key: string; status: string; data: unknown }>).map((r) => [r.item_key, r]),
  );
  if (priceRequestStale(outstanding, items)) {
    return {
      error:
        "The estimated selling price or the ESP reasoning has changed since this was sent, so your licensee can no longer approve it. Withdraw it and send a new one.",
    };
  }

  const { data: agency } = await supabase.from("agencies").select("name").eq("id", p.agency_id).maybeSingle();

  const emailed = await deliverLinkEmail(supabase, {
    requestId: outstanding.id,
    sentTo: outstanding.sentTo,
    agentEmail: (profile as { email?: string | null }).email ?? null,
    priorAttempts: outstanding.emailAttempts,
    build: (url) =>
      buildPriceStatementRequestEmail({
        agentName: (profile as { full_name?: string | null }).full_name || "Your agent",
        agencyName: (agency as { name?: string } | null)?.name ?? "the agency",
        propertyAddress: p.address,
        url,
        expiresAt: formatAuTimestamp(outstanding.expiresAt),
        priceStatement: outstanding.priceStatement!,
        espLow: outstanding.espLow,
        espHigh: outstanding.espHigh,
      }),
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return {
    error: emailed ? null : "Couldn't send that email. Try again in a moment.",
    sentTo: outstanding.sentTo,
    emailed,
  };
}

/**
 * Withdraws a price statement request that has not been approved. Also how
 * "Change wording" works: the words come back so the card can put them in the
 * box to edit and send again. The old link then opens on "no longer valid".
 *
 * Through the caller's own access, and only this listing's b4 request: the
 * final sign-off link has its own Withdraw (revokeSignoffLink).
 */
export async function withdrawPriceStatementLink(
  requestId: string,
  propertyId: string,
): Promise<{ error: string | null; priceStatement: string | null }> {
  const { supabase } = await requireAuthContext();

  const { data, error } = await supabase
    .from("property_signoff_requests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("property_id", propertyId)
    .eq("item_key", "b4")
    .is("signed_at", null)
    .is("revoked_at", null)
    .select("price_statement");

  if (error) {
    return { error: "Couldn't withdraw that request. Try again in a moment.", priceStatement: null };
  }
  if (!data || data.length === 0) {
    return { error: "That request has already been approved or withdrawn.", priceStatement: null };
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return {
    error: null,
    priceStatement: (data[0] as { price_statement?: string | null }).price_statement ?? null,
  };
}
