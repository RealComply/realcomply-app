import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const LEGAL_PATHS = new Set(["/terms", "/privacy", "/dpa"]);

/**
 * Refreshes the Supabase auth session on every request and redirects
 * signed-out users away from protected routes. Called from middleware.ts.
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
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthRoute = request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/auth");

  // /signoff/<token> is public by design: it is opened by a licensee in charge
  // who has no RealComply account and never will. Bouncing them to /login would
  // make the whole sign-off-by-link feature impossible. The token in the URL is
  // the credential, and the page reads nothing except through the two
  // SECURITY DEFINER functions in 0014_licensee_signoff_links.sql.
  //
  // The legal documents are public for the same kind of reason: a privacy
  // policy only account holders can read is not published, and the Stripe
  // customer portal and Meta's app review both link to them signed out.
  const isLegalRoute = LEGAL_PATHS.has(request.nextUrl.pathname);
  const isPublicRoute =
    request.nextUrl.pathname === "/" ||
    request.nextUrl.pathname.startsWith("/signoff/") ||
    isLegalRoute ||
    isAuthRoute;

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
