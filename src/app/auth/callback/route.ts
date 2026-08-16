import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notifyNewAgencySignup } from "@/lib/email/signup-notification";

// Handles the redirect after a user clicks the email confirmation link.
// If this is their first sign-in (no profile yet), bootstrap the agency
// using the full_name/agency_name that were stashed in user metadata at
// signup — see lib/actions/auth.ts.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
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
          website_url?: string | null;
        };
        if (meta.invite_token) {
          await supabase.rpc("accept_invite", { p_token: meta.invite_token, p_full_name: meta.full_name ?? "" });
        } else {
          const agencyName = meta.agency_name ?? "My agency";
          const fullName = meta.full_name ?? "";
          const { error: bootstrapError } = await supabase.rpc("bootstrap_agency", {
            p_agency_name: agencyName,
            p_full_name: fullName,
          });
          // Sign-off address, carried in user metadata from the signup form
          // because there was no session at that point to write it with. Only
          // once the agency row exists, and never for an invite signup.
          if (!bootstrapError && typeof meta.licensee_email === "string" && meta.licensee_email) {
            await supabase.rpc("set_agency_licensee_email", { p_email: meta.licensee_email });
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

      return NextResponse.redirect(`${origin}/dashboard/home`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent(
      "That confirmation link didn't work — try signing in.",
    )}`,
  );
}
