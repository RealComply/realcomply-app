"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";

// Resolves the origin the request actually came in on (e.g. the exact
// Vercel domain the user is visiting), so the email confirmation link
// always points back to a domain that's live and in Supabase's redirect
// allow-list — rather than relying on Supabase's configured Site URL,
// which has drifted from the real production domain before.
async function getOrigin() {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;
  const host = headersList.get("host");
  return `https://${host}`;
}

export type ActionState = { error: string | null };

export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard/home");
}

export async function signup(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "");
  const agencyName = String(formData.get("agencyName") ?? "");
  // Present only when this signup came from an invite link (see
  // src/lib/actions/team.ts / 0006_agency_invites.sql) — joins the existing
  // agency the invite was issued for instead of bootstrapping a new one.
  const inviteToken = String(formData.get("inviteToken") ?? "").trim() || null;
  // Where licensee sign-off links get sent. Optional, and never taken from an
  // invite signup — see the field's comment in src/app/signup/page.tsx.
  const licenseeEmail = String(formData.get("licenseeEmail") ?? "").trim();
  // Accepted as typed — "cassproperty.com.au" is what people write, and
  // making them find the scheme is the app doing nothing useful with their
  // time. See lib/normalise-url.ts.
  const website = normaliseWebsiteUrl(String(formData.get("websiteUrl") ?? ""));
  if (!website.ok) {
    return { error: website.error };
  }
  const websiteUrl = website.url;

  if (!inviteToken && !agencyName.trim()) {
    return { error: "Agency name is required." };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // invite_token rides along in user metadata so both the
      // email-confirmation callback and requireProfile's self-heal path
      // (for whichever one actually ends up running the join) know to call
      // accept_invite instead of bootstrap_agency.
      // licensee_email rides along for the same reason as agency_name: when
      // email confirmation is on there is no session here, so the value has to
      // survive until /auth/callback runs the bootstrap.
      data: {
        full_name: fullName,
        agency_name: agencyName,
        invite_token: inviteToken,
        licensee_email: licenseeEmail || null,
        website_url: websiteUrl || null,
      },
      // Without this, Supabase falls back to its configured Site URL —
      // which sends the confirmation link to the bare site root instead
      // of /auth/callback, so the code exchange (and the agency/profile
      // bootstrap that depends on it) never runs. See tech-stack-notes.md.
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (signUpError) {
    return { error: signUpError.message };
  }

  // If email confirmation is required, there's no session yet — the
  // agency/profile bootstrap (or invite acceptance) runs after they click
  // the confirmation link and land back in the app (see /auth/callback).
  if (!signUpData.session) {
    redirect(
      `/login?message=${encodeURIComponent(
        "Check your email to confirm your account, then sign in.",
      )}`,
    );
  }

  const { error: joinError } = inviteToken
    ? await supabase.rpc("accept_invite", { p_token: inviteToken, p_full_name: fullName })
    : await supabase.rpc("bootstrap_agency", { p_agency_name: agencyName, p_full_name: fullName });

  if (joinError) {
    return { error: joinError.message };
  }

  // After the agency exists, never before — the RPC writes to the caller's
  // own agency row, which does not exist until bootstrap_agency has run.
  // Deliberately not awaited into an error path: a missing sign-off address is
  // a prompt at Stage 5, not a reason to fail a signup that has otherwise
  // succeeded and already created the account.
  if (!inviteToken && licenseeEmail) {
    await supabase.rpc("set_agency_licensee_email", { p_email: licenseeEmail });
  }
  if (!inviteToken && websiteUrl) {
    await supabase.rpc("set_agency_website", { p_url: websiteUrl });
  }

  // Only for a brand-new agency, not someone joining an existing one via
  // invite — this is the "new signup" event, accept_invite isn't.
  if (!inviteToken) {
    await notifyNewAgencySignup({ agencyName, fullName, email });
  }

  redirect("/dashboard/home");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type InvitePreview = { agencyName: string; email: string; isLicenseeInCharge: boolean } | null;

// Called from the (unauthenticated) signup page when it's reached via an
// invite link, so it can show "you're joining <agency>" and lock the email
// field before an account even exists. Backed by invite_preview() in
// 0006_agency_invites.sql, which only returns a row for a still-pending
// invite — an unknown, already-accepted, or revoked token just comes back
// null and the signup page falls back to its normal "create a new agency"
// form.
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_preview", { p_token: trimmed }).maybeSingle();
  const row = data as { agency_name: string; email: string; is_licensee_in_charge: boolean } | null;

  if (error || !row) return null;
  return { agencyName: row.agency_name, email: row.email, isLicenseeInCharge: row.is_licensee_in_charge };
}
