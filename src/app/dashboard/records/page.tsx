import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { endedStateFor } from "@/lib/subscription-end/access";

// The address the subscription-end emails and Stripe's return link point at.
// For an agency whose subscription has ended, the dashboard layout shows the
// records page in place of this page (and of every other one), so this
// renders nothing of its own. For everyone else, including an agency that has
// just reactivated, there is no records page, so this goes home.
export default async function RecordsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  if (!(await endedStateFor(supabase, profile))) redirect("/dashboard/home");
  return null;
}
