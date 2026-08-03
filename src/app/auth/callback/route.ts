import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
        };
        await supabase.rpc("bootstrap_agency", {
          p_agency_name: meta.agency_name ?? "My agency",
          p_full_name: meta.full_name ?? "",
        });
      }

      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent(
      "That confirmation link didn't work — try signing in.",
    )}`,
  );
}
