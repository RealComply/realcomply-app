import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The marketing site (RealComply-landing-page.html) is separate from this
// app — this route is just the entry point into the product itself.
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
