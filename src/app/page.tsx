import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// No marketing page lives at the root any more (12 Aug 2026). Only Adam and
// a handful of test agents use RealComply right now — there's no audience
// to pitch and no reason to expose any branding or product detail to a
// stray visitor (Jye, the domain's previous owner, or anyone else) before
// there's a real client base. This route now does nothing but redirect:
// logged-in users to /dashboard (unchanged), everyone else straight to the
// already-bare /login form. See RealComply-brand-and-site-status.md —
// this supersedes the "bare hook" homepage (and the fuller MVP before
// that) that used to live here. Revisit once ready to promote in the open.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
