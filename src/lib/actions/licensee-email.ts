"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireProfile } from "@/lib/data/current-profile";
import { sendLicenseeConfirmation } from "@/lib/licensee-email/send";
import { sendAnnexureAfterConfirm } from "@/lib/sg-annexure/new-office";

// The licensee email confirms first (0112; Master, 4 Nov 2026). The database
// decides everything; these send the email and say what happened.

export type SendAgainState = { error: string | null; sent: boolean };

/** The database's own sentence when 0112 refuses, otherwise a plain fallback. */
function refusal(error: { code?: string; message?: string } | null, fallback: string): string {
  if ((error?.code === "P0001" || error?.code === "42501") && error.message) return error.message;
  return fallback;
}

/** Office profile, "Send again" (or the first send): anyone in the office. */
export async function sendLicenseeConfirmationAgain(): Promise<SendAgainState> {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("request_licensee_confirmation");
  if (error) return { error: refusal(error, "We couldn't send it. Try again in a few minutes."), sent: false };
  if (typeof id !== "string") return { error: "There's nothing to confirm. Reload the page.", sent: false };

  const outcome = await sendLicenseeConfirmation(createServiceClient(), profile.agency_id, {
    confirmationId: id,
    replyTo: profile.email,
  });
  revalidatePath("/dashboard/profile");
  if (outcome === "sent") return { error: null, sent: true };
  if (outcome === "not_needed") return { error: "There's nothing to confirm. Reload the page.", sent: false };
  return { error: "The email couldn't be sent. Try again in a few minutes.", sent: false };
}

export type ConfirmState = { error: string | null; confirmed: boolean };

/** The address in the request, for the record of the click. */
async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

/** The licensee's click, with no login. Then anything waiting for it goes. */
export async function confirmLicenseeEmail(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const token = String(formData.get("token") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { error: "This link is no longer valid.", confirmed: false };

  const supabase = await createClient();
  const { data: agencyId, error } = await supabase.rpc("confirm_licensee_email", {
    p_token: token,
    p_ip: await requestIp(),
  });
  if (error || typeof agencyId !== "string") {
    return {
      error: "This link is no longer valid. The office may have changed the licensee email since it was sent.",
      confirmed: false,
    };
  }

  // A new office's SG annexure waited for this (0112). Never fails the click.
  try {
    await sendAnnexureAfterConfirm(createServiceClient(), agencyId);
  } catch (err) {
    console.error("licensee confirm: annexure after confirm failed", agencyId, err);
  }
  return { error: null, confirmed: true };
}
