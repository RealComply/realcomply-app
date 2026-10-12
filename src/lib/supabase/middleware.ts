import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LEGAL_PATHS = new Set(["/terms", "/privacy", "/dpa"]);

/**
 * Whether a page must work for someone who is not signed in.
 *
 * Brought up to date when the proxy first started running (code review fixes,
 * part F1, 12 Oct 2026). The list had not been needed until then, and had
 * fallen behind: the unsubscribe link in every early access email, the
 * forgotten-password page, and the routes Stripe and Vercel's scheduler call
 * would all have been sent to /login.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/auth") ||
    pathname === "/forgot-password" ||
    // /signoff/<token> is public by design: it is opened by a licensee in
    // charge who has no RealComply account and never will. Bouncing them to
    // /login would make the whole sign-off-by-link feature impossible. The
    // token in the URL is the credential, and the page reads nothing except
    // through the two SECURITY DEFINER functions in
    // 0014_licensee_signoff_links.sql.
    pathname.startsWith("/signoff/") ||
    // The legal documents are public for the same kind of reason: a privacy
    // policy only account holders can read is not published, and the Stripe
    // customer portal and Meta's app review both link to them signed out.
    LEGAL_PATHS.has(pathname) ||
    // The unsubscribe link in an email. The signed token in the link is the
    // credential, and the Spam Act requires it to work.
    pathname === "/unsubscribe" ||
    // Route handlers answer for themselves (see the matcher in src/proxy.ts,
    // which keeps the proxy off them altogether).
    pathname.startsWith("/api/")
  );
}

/**
 * Refreshes the Supabase auth session on every request and redirects
 * signed-out users away from protected routes. Called from src/proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // A response that sets someone's session must never be cached and
          // served to someone else. The library says which headers prevent it.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
