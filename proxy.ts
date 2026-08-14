import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico
     * - public assets (svg, png, jpg, jpeg, gif, webp, html)
     *
     * html is included so static pages served straight out of /public
     * (e.g. /privacy.html) are reachable by logged-out visitors and
     * external crawlers (Meta App Review, etc.) instead of being bounced
     * to /login by the auth check below.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|html)$).*)",
  ],
};
