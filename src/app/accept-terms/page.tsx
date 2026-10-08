import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAcceptedCurrentLegal } from "@/lib/legal/acceptance";
import { legalDocument } from "@/lib/legal/documents";
import { AcceptLegalForm } from "@/components/legal/AcceptLegalForm";

export const metadata: Metadata = {
  title: "Updated terms · RealComply",
};

// Where the dashboard layout sends anyone who has not accepted the current
// terms and privacy policy. Deliberately outside /dashboard, so the layout's
// check cannot redirect this page to itself.
export default async function AcceptTermsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (await hasAcceptedCurrentLegal(supabase, user.id)) {
    redirect("/dashboard/home");
  }

  const terms = legalDocument("terms");
  const privacy = legalDocument("privacy");

  return <AcceptLegalForm terms={terms} privacy={privacy} />;
}
