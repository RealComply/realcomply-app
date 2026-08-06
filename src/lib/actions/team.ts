"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireAuthContext } from "@/lib/actions/compliance";

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
  const asLicensee = formData.get("isLicenseeInCharge") === "on";

  if (!email) {
    return { error: "An email address is required." };
  }

  const { data, error } = await supabase
    .from("agency_invites")
    .insert({
      agency_id: profile.agency_id,
      email: email.toLowerCase(),
      full_name: fullName,
      is_licensee_in_charge: asLicensee,
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

export async function revokeInvite(inviteId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return;
  }

  await supabase.from("agency_invites").update({ status: "revoked" }).eq("id", inviteId);
  revalidatePath("/dashboard/team");
}
