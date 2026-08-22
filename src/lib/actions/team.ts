"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAuthContext } from "@/lib/actions/compliance";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";

export type ActionState = { error: string | null };

// Same "figure out the real request origin" logic as lib/actions/auth.ts —
// duplicated rather than imported since that helper isn't exported and this
// keeps team.ts self-contained; both need it for the same reason (building
// a link that lands back on whichever domain the licensee is actually on).
async function getOrigin() {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;
  const host = headersList.get("host");
  return `https://${host}`;
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

// Creates a pending invite and returns the link to send the agent —
// there's no outbound email sending yet, so the licensee copies this and
// sends it themselves (text, existing email, whatever). Anyone who opens it
// can only join as the email address it was issued to (see accept_invite in
// 0006_agency_invites.sql) — the token isn't a bearer credential for "join
// as anyone."
export async function inviteAgent(
  _prev: ActionState & { inviteLink?: string },
  formData: FormData,
): Promise<ActionState & { inviteLink?: string }> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can invite agents." };
  }

  const email = str(formData, "email");
  const fullName = str(formData, "fullName");

  // Role is chosen at invite time now (Adam, 20 Aug 2026). The old form had a
  // single "licensee in charge" tick; there are three answers.
  const role = String(formData.get("role") ?? "agent");
  const asLicensee = role === "licensee";
  const asAssistant = role === "assistant";

  // Which agents an assistant supports. This IS their access — an assistant
  // with none sees nothing but what they create themselves, which is a
  // reasonable state (they can be attached later) but worth refusing here,
  // because an invite that grants nothing is almost always a slip.
  const supportsAgentIds = formData
    .getAll("supportsAgentIds")
    .map((v) => String(v))
    .filter(Boolean);

  if (!email) {
    return { error: "An email address is required." };
  }
  if (asAssistant && supportsAgentIds.length === 0) {
    return { error: "Choose at least one agent for this assistant to support." };
  }

  const { data, error } = await supabase
    .from("agency_invites")
    .insert({
      agency_id: profile.agency_id,
      email: email.toLowerCase(),
      full_name: fullName,
      is_licensee_in_charge: asLicensee,
      is_assistant: asAssistant,
      supports_agent_ids: asAssistant ? supportsAgentIds : [],
      invited_by: profile.id,
    })
    .select("token")
    .single();

  if (error || !data) {
    return { error: "Couldn't create the invite — try again." };
  }

  const origin = await getOrigin();
  revalidatePath("/dashboard/team");
  return { error: null, inviteLink: `${origin}/signup?invite=${data.token}` };
}

// Change which agents an assistant supports, after the fact. Licensee only —
// enforced here and again in RLS (0025), because an assistant granting
// themselves another agent's files would defeat the whole restriction.
//
// Replaces the whole set rather than adding one at a time: the form posts the
// ticked boxes, so what arrives IS the intended state, and reconciling to it
// means a box the licensee un-ticked actually goes away.
export async function setAssistantAgents(
  assistantId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change who an assistant supports." };
  }

  const wanted = new Set(formData.getAll("agentIds").map((v) => String(v)).filter(Boolean));

  const { data: existingRows } = await supabase
    .from("assistant_agents")
    .select("id, agent_id")
    .eq("assistant_id", assistantId);

  const existing = (existingRows ?? []) as { id: string; agent_id: string }[];
  const have = new Set(existing.map((r) => r.agent_id));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = existing.filter((r) => !wanted.has(r.agent_id)).map((r) => r.id);

  if (toAdd.length > 0) {
    const { error } = await supabase.from("assistant_agents").insert(
      toAdd.map((agentId) => ({
        agency_id: profile.agency_id,
        assistant_id: assistantId,
        agent_id: agentId,
        created_by: profile.id,
      })),
    );
    if (error) return { error: "Couldn't save that. Try again." };
  }

  if (toRemove.length > 0) {
    const { error } = await supabase.from("assistant_agents").delete().in("id", toRemove);
    if (error) return { error: "Couldn't save that. Try again." };
  }

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  return { error: null };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return;
  }

  await supabase.from("agency_invites").update({ status: "revoked" }).eq("id", inviteId);
  revalidatePath("/dashboard/team");
}

// Agency-level licensee email — the address sign-off links are addressed to.
// See 0014_licensee_signoff_links.sql for why this goes through an RPC rather
// than a direct update: agencies has a SELECT policy only, and opening a
// general UPDATE policy would expose every column on the table to set one
// field.
//
// Licensee-only. This decides where a sign-off request lands, so letting an
// agent change it would be a clean way to route their own file's sign-off to
// an address they control. The RPC scopes the write to the caller's own
// agency; this check is about which role may make it.
export async function saveLicenseeEmail(
  _prev: { error: string | null; saved: boolean },
  formData: FormData,
): Promise<{ error: string | null; saved: boolean }> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change this.", saved: false };
  }

  const email = String(formData.get("licenseeEmail") ?? "").trim();
  // Deliberately permissive: the input is type="email" so the browser has
  // already caught the obvious mistakes, and a stricter server-side pattern
  // mostly succeeds at rejecting valid addresses. Blank is allowed — it clears
  // the field, which is the only way to undo a wrong entry.
  if (email && !email.includes("@")) {
    return { error: "That doesn't look like an email address.", saved: false };
  }

  const licenseeName = String(formData.get("licenseeName") ?? "").trim();
  const { error } = await supabase.rpc("set_agency_licensee", { p_name: licenseeName, p_email: email });
  if (error) {
    return { error: "Couldn't save that. Try again.", saved: false };
  }

  // Saved in the same submission as the licensee email — one form, one button,
  // two agency-level settings. Validated only for shape: anything stricter here
  // rejects valid addresses more often than it catches bad ones, and a wrong
  // website surfaces immediately the first time the app tries to find a listing.
  // Typed the way a person says it — cassproperty.com.au — and normalised
  // here rather than demanded of them. See lib/normalise-url.ts.
  const website = normaliseWebsiteUrl(String(formData.get("websiteUrl") ?? ""));
  if (!website.ok) {
    return { error: website.error, saved: false };
  }

  const { error: siteError } = await supabase.rpc("set_agency_website", { p_url: website.url });
  if (siteError) {
    return { error: "Saved the email, but couldn't save the website. Try again.", saved: false };
  }

  revalidatePath("/dashboard/team");
  return { error: null, saved: true };
}
