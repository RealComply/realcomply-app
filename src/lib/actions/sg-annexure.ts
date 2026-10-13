"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireAccess } from "@/lib/data/current-profile";
import { SG_ANNEXURE_VERSION, firstNameOf } from "@/lib/legal/sg-annexure";
import { adoptionRefusal, saveSignedCopy } from "@/lib/sg-annexure/adopt";

// The two things a person does with the SG annexure (brief, 14 Oct 2026).

export type AdoptState = {
  error: string | null;
  /** Set once adopted: the first name for "Thank you, Sam". */
  adopted?: { firstName: string };
};

/**
 * "Sign and adopt", on the signed-out page. The database records the adoption
 * once (0067), whatever the browser sends twice; the signed copy follows.
 */
export async function adoptAnnexure(_prev: AdoptState, formData: FormData): Promise<AdoptState> {
  const token = String(formData.get("token") ?? "");
  if (token === "preview") {
    return { error: "This is a preview of the signing page. Nothing is signed here." };
  }
  const signedName = String(formData.get("signedName") ?? "").trim();
  const licenceNumber = String(formData.get("licenceNumber") ?? "").trim();
  if (!signedName) return { error: "Type your full name." };
  if (!licenceNumber) return { error: "Type your licence number." };
  if (formData.get("agree") !== "on") return { error: "Tick the box to adopt the annexure." };

  const supabase = await createClient();
  const { data: adoptionId, error } = await supabase.rpc("adopt_sg_annexure", {
    p_token: token,
    p_version: SG_ANNEXURE_VERSION,
    p_signed_name: signedName,
    p_licence_number: licenceNumber,
  });
  if (error || !adoptionId) return { error: adoptionRefusal(error) };

  // The adoption is recorded. The signed copy is filed and emailed with the
  // server's key (see lib/sg-annexure/adopt.ts); a failure there is logged and
  // never undoes the adoption.
  await saveSignedCopy(createServiceClient(), String(adoptionId));

  return { error: null, adopted: { firstName: firstNameOf(signedName) } };
}

/**
 * "Review and sign" on the Home card: a fresh link for the signed-in licensee
 * in charge of an office, and straight to it. Not an agent on their own plan
 * (CORRECTION, Adam, 14 Oct 2026). The database checks who is asking too
 * (create_sg_annexure_link, 0068).
 */
export async function openAnnexureSigning(): Promise<void> {
  const { access } = await requireAccess();
  if (!access.officeLicensee) redirect("/dashboard/home");

  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_sg_annexure_link");
  if (error || !token) {
    console.error("annexure: fresh link failed", error?.message);
    redirect("/dashboard/home?annexure=unavailable");
  }
  redirect(`/annexure/${token}`);
}
