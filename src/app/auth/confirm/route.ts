import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// An emailed link that works from any device.
//
// WHY THIS EXISTS, 26 August 2026.
//
// The password reset built this morning used Supabase's PKCE flow: asking for
// a reset stores a one-time verifier in the REQUESTING browser, and
// /auth/callback exchanges the emailed code against it. If the code arrives in
// a browser that does not hold that verifier, the exchange fails.
//
// Adam hit it within minutes of the first real test, and then put his finger on
// why it mattered — he quoted back the line I had written on the forgot-password
// page myself: "it only works in the browser you asked from."
//
// That sentence was me documenting a defect in reassuring language rather than
// fixing it. The everyday case is not a person testing in two windows. It is an
// agent who clicks "Forgotten?" at their desk and then picks up their phone,
// because that is where they read email. Under the old flow that link is dead,
// with no explanation that would mean anything to them.
//
// So recovery moves to the token-hash flow. The link carries a hash that this
// route verifies SERVER-SIDE with verifyOtp, which needs nothing stored in the
// browser that asked. Desk to phone, phone to laptop, borrowed machine — all
// fine. The link is still single-use and still expires; what it stops being is
// tied to one browser.
//
// /auth/callback stays exactly as it is. It still serves email confirmation,
// and it remains the fallback if a template is ever reverted to Supabase's
// default {{ .ConfirmationURL }}.
//
// THE EMAIL TEMPLATE IS HALF OF THIS. Supabase's "Reset password" template must
// point here rather than at the default confirmation URL:
//
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/dashboard/password
//
// Change one without the other and resets break, so they belong in the same
// note. See RealComply-email-sending-status.md.

// Only same-site paths, and only ones this product actually sends people to.
// A value off the query string is attacker-controllable; handing it to a
// redirect unchecked is how an open redirect gets built by accident, and
// "//evil.example" leaves the site while looking like a path.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard/home";
  return raw;
}

// Deliberately a small allow-list rather than "whatever the link says". These
// are the only flows RealComply emails, and an unexpected type reaching
// verifyOtp is a sign something is wrong rather than something to be helpful
// about.
const ALLOWED_TYPES = new Set<EmailOtpType>(["recovery", "email", "signup", "invite", "magiclink"]);

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = safeNext(searchParams.get("next"));

  const type = rawType as EmailOtpType | null;
  const isRecovery = type === "recovery";

  if (tokenHash && type && ALLOWED_TYPES.has(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

    if (!error) {
      // ?reset=1 tells /dashboard/password to say "set a new password" and
      // explain how they got there, rather than the "change your password"
      // wording someone sees when they arrive from the avatar menu.
      const destination = isRecovery && next === "/dashboard/password" ? `${next}?reset=1` : next;
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  // Now an honest message. The old one on /auth/callback said the link "may
  // have expired, or already been used" — which was wrong in the case that
  // actually happened, because the link was neither. Under this flow those two
  // really are the likely causes, so the sentence is finally true.
  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent(
      isRecovery
        ? "That reset link didn't work. Links last one hour and can only be used once — ask for a new one below."
        : "That link didn't work. It may have expired, or already been used.",
    )}`,
  );
}
