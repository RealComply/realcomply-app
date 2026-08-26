import type { SupabaseClient, User } from "@supabase/supabase-js";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";

// Everything that has to happen the first time somebody arrives with a
// confirmed email: record what they accepted, and give them an agency.
//
// WHY IT LIVES HERE, 26 August 2026.
//
// This was the body of /auth/callback, and it stayed there while callback was
// the only place an emailed link could land. It is not any more: /auth/confirm
// now handles the token-hash flow, which works from a device other than the one
// that asked (see that file for why that matters).
//
// Both routes have to do this identically. Copying it would have been quicker
// and would eventually have produced two versions that drifted — the same
// failure the extraction allow-list exists to prevent, one layer up. So it is
// one function with two callers, and neither route knows the details.
//
// WHY EMAIL CONFIRMATION IS WHERE THIS RUNS AT ALL. With confirmation ON there
// is no session during signup, so nothing can be written against the user until
// they come back from their inbox. Everything the form collected is parked in
// user metadata until this moment. That is also why it must not be skipped: the
// metadata is the only copy.

type SignupMetadata = {
  full_name?: string;
  agency_name?: string;
  invite_token?: string;
  licensee_email?: string | null;
  licensee_name?: string | null;
  website_url?: string | null;
  is_licensee?: boolean;
  terms_version?: string;
  privacy_version?: string;
};

/**
 * Safe to call on every arrival, including a second click of the same link.
 *
 * The acceptance write is idempotent per version pair, and the agency work is
 * skipped entirely once a profile exists — so a person who confirms twice, or
 * follows an old link, ends up in exactly the state they were already in.
 */
export async function completeSignup(supabase: SupabaseClient, user: User): Promise<void> {
  const meta = (user.user_metadata ?? {}) as SignupMetadata;

  // Acceptance first, and deliberately outside the no-profile check below.
  //
  // It is a fact about the person, not about whether their agency got set up.
  // A second confirmation click, or a bootstrap that already ran, must not be
  // the reason the record is missing — and this record is only worth anything
  // if it cannot have been skipped.
  if (meta.terms_version && meta.privacy_version) {
    await supabase.rpc("record_legal_acceptance", {
      p_terms_version: meta.terms_version,
      p_privacy_version: meta.privacy_version,
    });
  }

  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existingProfile) return;

  if (meta.invite_token) {
    await supabase.rpc("accept_invite", {
      p_token: meta.invite_token,
      p_full_name: meta.full_name ?? "",
    });
    return;
  }

  const agencyName = meta.agency_name ?? "My agency";
  const fullName = meta.full_name ?? "";

  // bootstrap_agency_v2, so the licensee answer given at signup survives the
  // confirmation round trip. Defaults to false rather than true if the metadata
  // is somehow absent: recording someone as the licensee in charge when nobody
  // said so is the bug migration 0029 fixed, and an agency with no licensee is
  // visible and fixable in Team settings where a wrongly-appointed one is not.
  const { error: bootstrapError } = await supabase.rpc("bootstrap_agency_v2", {
    p_agency_name: agencyName,
    p_full_name: fullName,
    p_is_licensee: meta.is_licensee === true,
  });

  if (bootstrapError) return;

  // Sign-off address, carried in user metadata from the signup form because
  // there was no session at that point to write it with. Only once the agency
  // row exists, and never for an invite signup.
  const licenseeEmail = typeof meta.licensee_email === "string" ? meta.licensee_email : "";
  const licenseeName = typeof meta.licensee_name === "string" ? meta.licensee_name : "";
  if (licenseeEmail || licenseeName) {
    await supabase.rpc("set_agency_licensee", { p_name: licenseeName, p_email: licenseeEmail });
  }

  if (typeof meta.website_url === "string" && meta.website_url) {
    await supabase.rpc("set_agency_website", { p_url: meta.website_url });
  }

  // Only once the agency actually exists — a failed bootstrap means there is no
  // new signup to report, and we returned above rather than send a notification
  // about an agency nobody can use.
  await notifyNewAgencySignup({ agencyName, fullName, email: user.email ?? "" });
}
