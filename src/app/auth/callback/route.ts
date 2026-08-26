import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { completeSignup } from "@/lib/auth/complete-signup";

// The PKCE code-exchange landing.
//
// This was the only place an emailed link landed until 26 Aug 2026, when
// /auth/confirm took over the links that need to work from a device other than
// the one that asked for them. What is left here is still doing a job:
//
//   * it is the fallback if an email template is ever reverted to Supabase's
//     default {{ .ConfirmationURL }} — a stray click in a console is all that
//     takes, and this is what stops that becoming an outage,
//   * and any link already sitting in somebody's inbox from before the change
//     still arrives here and still works.
//
// The bootstrap it used to perform inline now lives in lib/auth/complete-signup,
// shared with /auth/confirm, because two copies of that would drift.

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
      await completeSignup(supabase, data.user);
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Which link failed changes what the person should do about it, so say the
  // right one. "Try signing in" is useless advice to somebody who is here
  // precisely because they cannot.
  //
  // The reset wording is honest about the most likely cause now. Reaching this
  // route with a reset at all means the template has been reverted to the
  // default — under the token-hash flow resets land on /auth/confirm — so the
  // browser-bound failure is back in play and "ask for a new one" is the only
  // advice that reliably helps.
  const isReset = next.startsWith("/dashboard/password");

  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent(
      isReset
        ? "That reset link didn't work. Ask for a new one below, and open it on the same device you asked from."
        : "That confirmation link didn't work — try signing in.",
    )}`,
  );
}
