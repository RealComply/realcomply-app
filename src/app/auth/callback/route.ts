import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";

// Handles the redirect after a user clicks an emailed link — an email
// confirmation, or (since 26 Aug 2026) a password reset. If this is their
// first sign-in (no profile yet), bootstrap the agency using the
// full_name/agency_name that were stashed in user metadata at signup — see
// lib/actions/auth.ts.

// Where to send someone once the code has been exchanged. Defaults to Home,
// which is what an email confirmation wants; a password reset passes
// ?next=/dashboard/password so they land on the form that finishes the job.
//
// Only same-site paths are honoured. A value that came in on the query string
// is attacker-controllable, and handing it straight to a redirect is how an
// open redirect gets built by accident — the "//evil.example" case matters as
// much as "https://evil.example", because a protocol-relative URL leaves the
// site while looking like a path.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard/home";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Acceptance first, and outside the no-profile branch.
      //
      // With email confirmation ON there is no session during signup, so this
      // is the first moment the acceptance can be written at all. It sits
      // before the profile check because it is a fact about the person, not
      // about whether their agency got set up: a second confirmation click, or
      // a bootstrap that already ran, must not cause the record to be skipped.
      // record_legal_acceptance is idempotent per version pair, so calling it
      // on every callback is harmless.
      const legalMeta = data.user.user_metadata as {
        terms_version?: string;
        privacy_version?: string;
      };
      if (legalMeta.terms_version && legalMeta.privacy_version) {
        await supabase.rpc("record_legal_acceptance", {
          p_terms_version: legalMeta.terms_version,
          p_privacy_version: legalMeta.privacy_version,
        });
      }

      const { data: existingProfile } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();

      if (!existingProfile) {
        const meta = data.user.user_metadata as {
          full_name?: string;
          agency_name?: string;
          invite_token?: string;
          licensee_email?: string | null;
          licensee_name?: string | null;
          website_url?: string | null;
          is_licensee?: boolean;
        };
        if (meta.invite_token) {
          await supabase.rpc("accept_invite", { p_token: meta.invite_token, p_full_name: meta.full_name ?? "" });
        } else {
          const agencyName = meta.agency_name ?? "My agency";
          const fullName = meta.full_name ?? "";
          // bootstrap_agency_v2, so the licensee answer given at signup survives
          // the confirmation round trip. Defaults to false rather than true if
          // the metadata is somehow absent: recording someone as the licensee
          // in charge when nobody said so is the bug migration 0029 fixes, and
          // an agency with no licensee is visible and fixable in Team settings
          // where a wrongly-appointed one is not.
          const { error: bootstrapError } = await supabase.rpc("bootstrap_agency_v2", {
            p_agency_name: agencyName,
            p_full_name: fullName,
            p_is_licensee: meta.is_licensee === true,
          });
          // Sign-off address, carried in user metadata from the signup form
          // because there was no session at that point to write it with. Only
          // once the agency row exists, and never for an invite signup.
          const licenseeEmail = typeof meta.licensee_email === "string" ? meta.licensee_email : "";
          const licenseeName = typeof meta.licensee_name === "string" ? meta.licensee_name : "";
          if (!bootstrapError && (licenseeEmail || licenseeName)) {
            await supabase.rpc("set_agency_licensee", { p_name: licenseeName, p_email: licenseeEmail });
          }
          if (!bootstrapError && typeof meta.website_url === "string" && meta.website_url) {
            await supabase.rpc("set_agency_website", { p_url: meta.website_url });
          }
          // Only notify once the agency actually exists — an RPC error here
          // means there's no new signup to report.
          if (!bootstrapError) {
            await notifyNewAgencySignup({ agencyName, fullName, email: data.user.email ?? "" });
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Which link failed changes what the person should do about it, so say the
  // right one. "Try signing in" is useless advice to somebody who is here
  // precisely because they cannot.
  const isReset = next.startsWith("/dashboard/password");

  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent(
      isReset
        ? "That reset link didn't work — it may have expired, or already been used. Ask for a new one below."
        : "That confirmation link didn't work — try signing in.",
    )}`,
  );
}
