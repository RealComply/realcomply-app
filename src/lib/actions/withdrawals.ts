"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { withdrawalProblem } from "@/lib/rules/listing-tabs";
import { isInFolder, storedFileProblem } from "@/lib/storage/evidence";
import { sydneyDate } from "@/lib/subscription-end/dates";

// Withdraw from market, and Put back on the market (Job B, 6 Nov 2026; 0114).
// The database decides who may and stamps who and when
// (withdraw_listing, put_listing_back_on_market); these check the form first
// and give the database's refusal back in its own plain words.

export type WithdrawalState = { error: string | null; done?: boolean };

/** A refusal from the database in the app's words; the one we can't word, plainly. */
function refusal(error: { message?: string; code?: string } | null): string | null {
  if (!error) return null;
  // Before 0114 is run there is nothing to call.
  if (error.code === "PGRST202" || /could not find the function/i.test(error.message ?? "")) {
    return "Withdrawing a listing isn't switched on yet. Try again later.";
  }
  return error.message || "That didn't save. Try again.";
}

export async function withdrawListing(
  propertyId: string,
  _prev: WithdrawalState,
  formData: FormData,
): Promise<WithdrawalState> {
  const { supabase, profile } = await requireAuthContext();

  const withdrawnOn = String(formData.get("withdrawnOn") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const reasonOther = String(formData.get("reasonOther") ?? "").trim();
  const evidencePath = String(formData.get("evidencePath") ?? "").trim() || null;
  const evidenceFileName = String(formData.get("evidenceFileName") ?? "").trim() || null;

  const problem = withdrawalProblem({ withdrawnOn, reason, reasonOther, today: sydneyDate(new Date()) });
  if (problem) return { error: problem };

  if (evidencePath) {
    if (!isInFolder(evidencePath, `${profile.agency_id}/${propertyId}/withdrawal/`)) {
      return { error: "That upload isn't in this listing's folder. Try again." };
    }
    const empty = await storedFileProblem(supabase, evidencePath);
    if (empty) return { error: empty };
  }

  const { error } = await supabase.rpc("withdraw_listing", {
    p_property: propertyId,
    p_withdrawn_on: withdrawnOn,
    p_reason: reason,
    p_reason_other: reason === "other" ? reasonOther : null,
    p_evidence_path: evidencePath,
    p_evidence_file_name: evidencePath ? evidenceFileName : null,
  });
  const failed = refusal(error);
  if (failed) return { error: failed };

  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard");
  return { error: null, done: true };
}

export async function putBackOnMarket(propertyId: string): Promise<WithdrawalState> {
  const { supabase } = await requireAuthContext();
  const { error } = await supabase.rpc("put_listing_back_on_market", { p_property: propertyId });
  const failed = refusal(error);
  if (failed) return { error: failed };
  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard");
  return { error: null, done: true };
}
