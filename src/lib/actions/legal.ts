"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentLegalVersions } from "@/lib/legal/documents";

export type AcceptLegalState = { error: string | null };

// Re-acceptance by an existing user after the terms or privacy policy change.
// See lib/legal/acceptance.ts for why this exists, and 0026 for the log it
// writes to.
export async function acceptCurrentLegal(
  _prevState: AcceptLegalState,
  formData: FormData,
): Promise<AcceptLegalState> {
  if (formData.get("acceptLegal") !== "yes") {
    return { error: "Tick the box to accept the Terms and Conditions and Privacy Policy." };
  }

  // The versions that were on screen ride along in the form. If a new version
  // was published between the page loading and the button being pressed, the
  // person has not read what we would be recording, so they are sent back to
  // read it rather than being stamped as accepting text they never saw.
  const current = currentLegalVersions();
  if (formData.get("termsVersion") !== current.terms || formData.get("privacyVersion") !== current.privacy) {
    return { error: "These documents changed while the page was open. Reload the page to see the current versions." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("record_legal_acceptance", {
    p_terms_version: current.terms,
    p_privacy_version: current.privacy,
  });
  if (error) {
    return { error: "We couldn't record your acceptance just now. Try again in a moment." };
  }

  redirect("/dashboard/home");
}
