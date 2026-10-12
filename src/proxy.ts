import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Runs before every page: refreshes the signed-in session and sends a
// signed-out visitor to /login (src/lib/supabase/middleware.ts).
//
// IN src/, BESIDE app/ (code review fixes, part F1, 12 Oct 2026). Next only
// runs this file from the folder that holds app/, and app/ is in src/. It sat
// at the repo root from the first scaffold on 3 Aug 2026 and never ran: every
// page has protected itself since (requireProfile), but sessions were never
// refreshed in the background, so people were signed out sooner than they
// should have been.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/ (route handlers answer for themselves: the scheduled jobs check
     *   their secret, Stripe's webhook its signature, search the signed-in
     *   user. None needs a session refresh, and a redirect to /login is
     *   never the right answer to Stripe or Vercel's scheduler)
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico
     * - public assets (svg, png, jpg, jpeg, gif, webp, html)
     *
     * html is included so static pages served straight out of /public
     * (e.g. /privacy.html) are reachable by logged-out visitors and
     * external crawlers (Meta App Review, etc.) instead of being bounced
     * to /login by the auth check below.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
