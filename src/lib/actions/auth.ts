"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";
import { currentLegalVersions } from "@/lib/legal/documents";
import { openSignupsAllowed } from "@/lib/signups";

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
  const licenseeName = String(formData.get("licenseeName") ?? "").trim();
  // Whether the person signing up IS the licensee in charge, asked outright on
  // the form. Until 23 Aug 2026 this was assumed true for everyone who created
  // an agency, which made the answer worthless — see migration 0029.
  const isLicenseeRaw = String(formData.get("isLicensee") ?? "").trim();
  const isLicensee = isLicenseeRaw === "yes";
  // Accepted as typed — "cassproperty.com.au" is what people write, and
  // making them find the scheme is the app doing nothing useful with their
  // time. See lib/normalise-url.ts.
  const website = normaliseWebsiteUrl(String(formData.get("websiteUrl") ?? ""));
  if (!website.ok) {
    return { error: website.error };
  }
  const websiteUrl = website.url;

  // THE ACTUAL DOOR (Adam, 24 Aug 2026: "can we put a block on that like we had
  // before?").
  //
  // Checked here, not just on the page. A Server Action is a real POST endpoint,
  // and a page that declines to render a form stops an ordinary visitor while
  // doing nothing at all about a hand-rolled request. The same reasoning as the
  // legal-acceptance check below.
  //
  // Invites are deliberately exempt. An invite is bound to one address, only a
  // licensee in charge can issue one, and a human has vouched for the person —
  // which is precisely the arrangement that made running with email
  // confirmation switched off acceptable. Closing public signup restores that
  // arrangement rather than adding a new restriction.
  if (!inviteToken && !(await openSignupsAllowed())) {
    return {
      error:
        "RealComply is invite-only at the moment. If your licensee has sent you a link, open that link to join their office.",
    };
  }

  if (!inviteToken && !agencyName.trim()) {
    return { error: "Agency name is required." };
  }

  // Re-checked here, not trusted from the form, for the same reason as the
  // acceptance checkbox below: a Server Action is a real POST endpoint and a
  // hand-rolled request sails straight past anything the form enforces.
  //
  // An unanswered question is refused rather than defaulted. Defaulting is what
  // produced the bug this replaces.
  if (!inviteToken) {
    if (isLicenseeRaw !== "yes" && isLicenseeRaw !== "no") {
      return { error: "Let us know whether you're the licensee in charge." };
    }
    // Required on "no", because at that point we know a second person exists,
    // that sign-off requests have to reach them, and that no file can close
    // without their signature. Collecting it later would just defer that.
    if (isLicenseeRaw === "no" && (!licenseeName || !licenseeEmail)) {
      return { error: "Add your licensee in charge's name and email so we know who to send sign-off requests to." };
    }
  }

  // Acceptance of the published documents, re-checked here rather than trusted
  // from the form. `required` on the checkbox stops an ordinary person
  // submitting without it; a Server Action is a real POST endpoint and a
  // hand-rolled request would sail straight past that. The whole value of this
  // record is that it cannot have been skipped, so the check has to live where
  // the account is actually created.
  if (formData.get("acceptLegal") !== "yes") {
    return { error: "Please accept the Terms of Service and Privacy Policy to continue." };
  }
  const legalVersions = currentLegalVersions();

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
        licensee_name: licenseeName || null,
        is_licensee: isLicensee,
        website_url: websiteUrl || null,
        // Carried for the same reason as agency_name: with email confirmation
        // ON there is no session in this request, so the acceptance cannot be
        // written yet. It has to survive until /auth/callback runs, or the
        // record would only ever exist for people who signed up during the
        // window when confirmation happened to be off.
        terms_version: legalVersions.terms,
        privacy_version: legalVersions.privacy,
      },
      // Without this, Supabase falls back to its configured Site URL —
      // which sends the confirmation link to the bare site root instead
      // of /auth/callback, so the code exchange (and the agency/profile
      // bootstrap that depends on it) never runs. See tech-stack-notes.md.
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (signUpError) {
    // The rate limit deserves its own words. Supabase's own message is "email
    // rate limit exceeded", which tells a new agent nothing they can act on and
    // sounds like they did something wrong.
    //
    // What has actually happened: the confirmation email was refused, so the
    // signup did not complete. While Supabase custom SMTP is off the whole
    // project shares a cap of 2 auth emails per hour — so the third person to
    // join in an hour, across every agency, simply cannot. That is a hard
    // refusal rather than a delay; nothing is queued and nothing arrives late.
    //
    // See RealComply-email-sending-status.md: pointing custom SMTP at SES
    // removes the cap entirely, and this message stops being reachable in
    // ordinary use.
    if (signUpError.status === 429) {
      return {
        error:
          "We couldn't send your confirmation email just now, so the account wasn't created. Wait a few minutes and try again — and if it keeps happening, let us know rather than trying repeatedly.",
      };
    }
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

  // Before the join, not after. If bootstrap_agency or accept_invite fails,
  // the account still exists and the person still accepted the documents, so
  // the acceptance is still a true record of something that happened. Writing
  // it only on the success path would lose it exactly when the signup is going
  // to be retried.
  await supabase.rpc("record_legal_acceptance", {
    p_terms_version: legalVersions.terms,
    p_privacy_version: legalVersions.privacy,
  });

  const { error: joinError } = inviteToken
    ? await supabase.rpc("accept_invite", { p_token: inviteToken, p_full_name: fullName })
    : await supabase.rpc("bootstrap_agency_v2", {
        p_agency_name: agencyName,
        p_full_name: fullName,
        p_is_licensee: isLicensee,
      });

  if (joinError) {
    return { error: joinError.message };
  }

  // After the agency exists, never before — the RPC writes to the caller's
  // own agency row, which does not exist until bootstrap_agency has run.
  // Deliberately not awaited into an error path: a missing sign-off address is
  // a prompt at Stage 5, not a reason to fail a signup that has otherwise
  // succeeded and already created the account.
  if (!inviteToken && (licenseeEmail || licenseeName)) {
    await supabase.rpc("set_agency_licensee", { p_name: licenseeName, p_email: licenseeEmail });
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

// ── Forgotten and changed passwords ────────────────────────────────────────
//
// Added 26 Aug 2026, after Sue at Cass Property couldn't sign in. Her account
// was healthy in every respect — confirmed, password set, profile attached to
// the agency — and her last sign-in was the exact second she created it on
// 19 August. She had simply lost the password, and until today a RealComply
// password could be set exactly once, at signup, and never recovered or
// changed. There was no link, no route, and nothing an agency could do about
// it except ask us to reach into the database.
//
// Every agency would have hit this. It is also the kind of hole that is much
// worse in a compliance product than elsewhere: the person locked out is
// usually the one being chased for a sign-off.

export type ResetRequestState = { error: string | null; sent: boolean };

export async function requestPasswordReset(
  _prevState: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter the email address you sign in with.", sent: false };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Explicit, for the same reason emailRedirectTo is explicit on signup:
    // without it Supabase falls back to the configured Site URL, which is the
    // bare site root. The root is the marketing page and it ignores ?code=
    // entirely, so the link would land the person on a page about RealComply
    // and leave them just as locked out. Verified 26 Aug — Site URL is
    // https://realcomply.com.au, and this callback path is covered by the
    // redirect allow-list entry https://realcomply.com.au/**.
    redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/dashboard/password?reset=1")}`,
  });

  // The same answer whether or not that address has an account. Anything else
  // turns this form into a way of asking "does this agent use RealComply?",
  // and an address that is not registered is not the sender's business.
  //
  // The one exception is a rate limit. Supabase's built-in auth mail is capped
  // (2/hour on this project — the cap that forced email confirmation off on
  // 19 Aug), and silently swallowing that would leave someone refreshing an
  // inbox that is never going to receive anything. Telling them to wait leaks
  // nothing they could not learn by waiting.
  // CORRECTED 26 Aug 2026, and the earlier wording was a lie the app told.
  //
  // This used to read "The email is on its way — give it a few minutes." It is
  // not on its way. A 429 here means the send was REFUSED: either the
  // per-address cooldown (asked again within a minute) or the project-wide cap
  // on auth email, which is 2 per hour while Supabase custom SMTP is off. In
  // neither case is anything queued for later — Supabase does not hold the
  // message and retry it.
  //
  // Telling someone locked out of their account that a reset is coming, when
  // nothing was sent, leaves them refreshing an inbox instead of trying again.
  // The message has to be true in both cases, so it says what happened and
  // what to do rather than making a promise about delivery.
  if (error?.status === 429) {
    return {
      error:
        "That didn't send — too many emails have gone out in the last little while. Nothing is on its way yet, so wait a few minutes and ask again.",
      sent: false,
    };
  }

  return { error: null, sent: true };
}

export type PasswordState = { error: string | null; saved: boolean };

// Used by both arrivals: someone who followed a reset link (and therefore has
// a session created by the code exchange in /auth/callback) and someone
// already signed in who just wants to change their password. Supabase treats
// both identically — updateUser acts on the caller's own session and nothing
// else — so one action and one screen serve both, and there is no second path
// to keep correct.
export async function updatePassword(
  _prevState: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  // Eight rather than Supabase's default six. Not a policy anyone has to
  // remember or rotate — just a floor low enough that nobody is fighting it
  // and high enough not to be embarrassing in a compliance product.
  if (password.length < 8) {
    return { error: "Use at least 8 characters.", saved: false };
  }
  if (password !== confirmPassword) {
    return { error: "Those two don't match — check the second box.", saved: false };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No session means the reset link expired before they got to this form, or
  // they arrived here directly. Either way the honest answer is to start again
  // rather than fail on save.
  if (!user) {
    redirect(
      `/login?message=${encodeURIComponent(
        "That reset link has expired. Ask for a new one and it'll come straight through.",
      )}`,
    );
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message, saved: false };
  }

  return { error: null, saved: true };
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
