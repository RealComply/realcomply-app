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
  _prev: { error: string | null; saved: boolean; licenseeChanged?: boolean },
  formData: FormData,
): Promise<{ error: string | null; saved: boolean; licenseeChanged?: boolean }> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change this.", saved: false };
  }

  // Who was recorded before this save, so we can tell an actual change of
  // licensee from a corrected typo. Read first, because the RPC below
  // overwrites it.
  const { data: beforeRow } = await supabase
    .from("agencies")
    .select("licensee_name")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const previousName = ((beforeRow as { licensee_name?: string | null } | null)?.licensee_name ?? "").trim();

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

  // A CHANGE, not a first entry and not an edited address.
  //
  // Appointing a licensee in charge is notifiable to the Secretary within 5
  // business days (s31(3) of the Act), and the app's job here is to say so
  // once, not to track it. Adam, 23 Aug 2026: "rather than us policing it,
  // all we'll do is have a pop up screen with that clause... Agent makes the
  // records, we just keep them on track with a helping hand."
  //
  // Only fires where a name was already recorded and is now a different one.
  // Filling the field in for the first time is someone finishing their setup,
  // not replacing anybody, and firing there would be noise on day one — which
  // is how a notice earns itself a reputation for being dismissed unread.
  const licenseeChanged =
    previousName.length > 0 && previousName.toLowerCase() !== licenseeName.toLowerCase();

  return { error: null, saved: true, licenseeChanged };
}

// The agency's own logo, drawn on the finalised compliance record.
//
// Adam, 23 Aug 2026: "when an office subscription is set up, they're going to
// have to add their logo. If it's an individual agent, then perhaps what we do
// is have the office name then the agent's name without a logo."
//
// The browser uploads the file straight to Storage (same reason as every other
// upload here — Vercel caps request bodies at 4.5MB) and this records the path.
// Licensee-only, enforced again inside set_agency_logo: the logo is what the
// agency's compliance record is signed with in the eyes of whoever reads it.
export async function saveAgencyLogo(
  _prev: { error: string | null; saved: boolean },
  formData: FormData,
): Promise<{ error: string | null; saved: boolean }> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can change the agency logo.", saved: false };
  }

  const path = String(formData.get("logoPath") ?? "").trim();

  // Blank clears it, which is the only way back to the text masthead once a
  // logo has been set.
  if (path) {
    // Belt and braces with the upload control's own accept list. pdf-lib embeds
    // PNG and JPEG and nothing else, so anything else here would produce a
    // broken export rather than a rejected upload — and it would break at the
    // moment somebody is trying to hand a document to Fair Trading.
    if (!/\.(png|jpe?g)$/i.test(path)) {
      return { error: "The logo has to be a PNG or JPG.", saved: false };
    }
    if (!path.startsWith(`${profile.agency_id}/`)) {
      return { error: "That file doesn't belong to your agency.", saved: false };
    }
  }

  const { error } = await supabase.rpc("set_agency_logo", { p_path: path });
  if (error) {
    return { error: "Couldn't save the logo. Try again.", saved: false };
  }

  revalidatePath("/dashboard/team");
  return { error: null, saved: true };
}

// ── Managing the people in the office ──────────────────────────────────────
//
// Adam, 26 Aug 2026: "as the licensee i should be able to edit staff."
//
// Until now a licensee could invite someone and correct their licence details,
// and that was the whole of it. A name typed wrong at invite time stayed wrong,
// a role chosen then could never change, and nobody could ever be removed. The
// roster only grew.
//
// All three actions below are licensee-only, and all three lean on the RLS
// policy 0004 opened for the licence-details case ("profiles: licensee can
// update agency members"). The invariant that an agency always has a licensee
// in charge is enforced by a trigger in 0035, not here — an agency with nobody
// able to sign off is unrecoverable from the UI, so that one belongs in the
// database.

type StaffRow = {
  id: string;
  agency_id: string;
  full_name: string | null;
  is_agent: boolean;
  is_assistant: boolean;
  is_licensee_in_charge: boolean;
  archived_at: string | null;
};

// Shared preamble: the caller must be the licensee, and the subject must be
// somebody in their own agency. The agency check matters — a profile id is a
// uuid off a form, and RLS scopes the read, but saying so plainly here means a
// wrong id gets a sentence rather than a silent no-op.
type LicenseeCheck =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"];
      profile: Awaited<ReturnType<typeof requireAuthContext>>["profile"];
      subject: StaffRow;
    };

// Discriminated on `ok`, not on whether `error` happens to be null. TypeScript
// narrows a literal boolean cleanly; it will not narrow a union whose other
// members carry optional fields, which is how the first attempt at this failed
// to compile.
async function requireLicenseeAndSubject(profileId: string): Promise<LicenseeCheck> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { ok: false, error: "Only the licensee in charge can change someone's details." };
  }

  const { data } = await supabase
    .from("profiles")
    .select("id, agency_id, full_name, is_agent, is_assistant, is_licensee_in_charge, archived_at")
    .eq("id", profileId)
    .maybeSingle();

  const subject = data as StaffRow | null;
  if (!subject || subject.agency_id !== profile.agency_id) {
    return { ok: false, error: "That person isn't in your agency." };
  }

  return { ok: true, supabase, profile, subject };
}

/** Listings still on someone's name that are not yet finished. */
async function openListingsFor(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
  profileId: string,
): Promise<number> {
  const { count } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("created_by", profileId)
    .lt("stage", 5);
  return count ?? 0;
}

export async function updateStaffName(
  profileId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireLicenseeAndSubject(profileId);
  if (!ctx.ok) return { error: ctx.error };

  const fullName = String(formData.get("fullName") ?? "").trim();
  if (!fullName) {
    return { error: "A name is required." };
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", profileId);

  if (error) return { error: "Couldn't save that name — try again." };

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard/registers");
  return { error: null };
}

/**
 * Agent, assistant, or licensee in charge.
 *
 * Two refusals here rather than in the database, because both are recoverable
 * workflow problems rather than corruption — and both have a next step the
 * licensee can actually take.
 *
 *   * An agent holding unfinished listings cannot become an assistant.
 *     Assistants prepare files for other people and cannot sign one, so those
 *     listings would have nobody able to complete them. The fix is to move them
 *     first, which is what listing transfer is for (0034).
 *
 *   * An assistant cannot be made licensee in charge while still an assistant.
 *     The two are contradictory: an assistant is defined by working on behalf
 *     of particular agents, and a licensee in charge supervises all of them.
 *
 * Losing the last licensee is a different class of problem and is refused by
 * the trigger in 0035 — that one would leave an agency where no file can ever
 * be signed off again.
 */
export async function setStaffRole(
  profileId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireLicenseeAndSubject(profileId);
  if (!ctx.ok) return { error: ctx.error };

  const role = String(formData.get("role") ?? "");
  if (!["agent", "assistant", "licensee"].includes(role)) {
    return { error: "Choose a role." };
  }

  const supportsAgentIds = formData
    .getAll("supportsAgentIds")
    .map((v) => String(v))
    .filter(Boolean);

  if (role === "assistant") {
    const open = await openListingsFor(ctx.supabase, profileId);
    if (open > 0) {
      return {
        error: `${ctx.subject.full_name ?? "They"} still has ${open} listing${open === 1 ? "" : "s"} on the go. An assistant can't hold a listing or sign one, so move those to another agent first.`,
      };
    }
    if (supportsAgentIds.length === 0) {
      return { error: "Choose at least one agent for this assistant to support." };
    }
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({
      // is_agent stays true for a licensee in charge: plenty of licensees run
      // their own listings, and the two were always independent (see 0001).
      is_agent: role !== "assistant",
      is_assistant: role === "assistant",
      is_licensee_in_charge: role === "licensee",
    })
    .eq("id", profileId);

  if (error) {
    // The trigger's message is already written for a person to read, so pass it
    // through rather than replacing it with something vaguer.
    const fromTrigger = /licensee in charge/i.test(error.message);
    return { error: fromTrigger ? error.message : "Couldn't change that role — try again." };
  }

  // Someone who is no longer an assistant should not keep the agents they
  // supported: that list IS their access, and leaving it behind would quietly
  // grant it again if they were ever made an assistant a second time.
  if (role !== "assistant") {
    await ctx.supabase.from("assistant_agents").delete().eq("assistant_id", profileId);
  } else {
    const { data: existingRows } = await ctx.supabase
      .from("assistant_agents")
      .select("id, agent_id")
      .eq("assistant_id", profileId);

    const existing = (existingRows ?? []) as { id: string; agent_id: string }[];
    const wanted = new Set(supportsAgentIds);
    const have = new Set(existing.map((r) => r.agent_id));

    const toAdd = [...wanted].filter((id) => !have.has(id));
    const toRemove = existing.filter((r) => !wanted.has(r.agent_id)).map((r) => r.id);

    if (toAdd.length > 0) {
      await ctx.supabase.from("assistant_agents").insert(
        toAdd.map((agentId) => ({
          agency_id: ctx.profile.agency_id,
          assistant_id: profileId,
          agent_id: agentId,
          created_by: ctx.profile.id,
        })),
      );
    }
    if (toRemove.length > 0) {
      await ctx.supabase.from("assistant_agents").delete().in("id", toRemove);
    }
  }

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  return { error: null };
}

/**
 * Removing someone who has left.
 *
 * Archiving, never deleting. Their signatures, CPD records, gift entries and
 * the listings they ran are the record of what happened; the person leaving
 * does not change what they did. 0035 has the full reasoning.
 *
 * Refused while they still hold unfinished listings, because an archived person
 * cannot sign anything — those files would stall with nobody able to finish
 * them. Move the listings first.
 */
export async function archiveStaff(profileId: string): Promise<ActionState> {
  const ctx = await requireLicenseeAndSubject(profileId);
  if (!ctx.ok) return { error: ctx.error };

  if (profileId === ctx.profile.id) {
    return { error: "You can't remove yourself. Appoint another licensee in charge first, and they can do it." };
  }
  if (ctx.subject.archived_at) {
    return { error: "They've already been removed." };
  }

  const open = await openListingsFor(ctx.supabase, profileId);
  if (open > 0) {
    return {
      error: `${ctx.subject.full_name ?? "They"} still has ${open} unfinished listing${open === 1 ? "" : "s"}. Move those to another agent first — an archived person can't sign a file, so they'd have nobody to complete them.`,
    };
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ archived_at: new Date().toISOString(), archived_by: ctx.profile.id })
    .eq("id", profileId);

  if (error) {
    const fromTrigger = /licensee in charge/i.test(error.message);
    return { error: fromTrigger ? error.message : "Couldn't remove them — try again." };
  }

  // An assistant's agent list is their access. Clearing it on the way out means
  // restoring them later starts from nothing rather than silently handing back
  // whatever they could see a year ago.
  await ctx.supabase.from("assistant_agents").delete().eq("assistant_id", profileId);

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  return { error: null };
}

/** Someone archived by mistake, or back after a break. */
export async function restoreStaff(profileId: string): Promise<ActionState> {
  const ctx = await requireLicenseeAndSubject(profileId);
  if (!ctx.ok) return { error: ctx.error };

  if (!ctx.subject.archived_at) {
    return { error: "They're already active." };
  }

  const { error } = await ctx.supabase
    .from("profiles")
    .update({ archived_at: null, archived_by: null })
    .eq("id", profileId);

  if (error) return { error: "Couldn't bring them back — try again." };

  revalidatePath("/dashboard/team");
  revalidatePath("/dashboard");
  return { error: null };
}
