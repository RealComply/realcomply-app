"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { isInFolder, storedFileProblem } from "@/lib/storage/evidence";
import { readNoticeIntoPending } from "@/lib/esp-notice";
import { pendingFrom, typedFigure } from "@/lib/esp-history";

// ESP revision history (Adam, 3 Nov 2026; mockup approved; 0110). The d3 card's
// actions: a notice uploaded is read into a draft; the agent checks the figures
// and saves, which records a new revision and never writes over an earlier one.

export type EspActionState = { error: string | null };

/** The notice just uploaded to the listing's d3 folder: read it into the card's draft. */
export async function readEspNotice(propertyId: string, path: string, fileName: string): Promise<EspActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!isInFolder(path, `${profile.agency_id}/${propertyId}/d3`)) {
    return { error: "That upload isn't in this listing's folder. Try again." };
  }
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };
  const result = await readNoticeIntoPending(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    path,
    fileName: fileName.trim() || "Revised ESP notice",
  });
  revalidatePath(`/dashboard/${propertyId}`);
  return result;
}

/** Cancel: the draft goes; the latest revision, its notice and the card stay as they were. */
export async function cancelEspDraft(propertyId: string): Promise<EspActionState> {
  const { supabase } = await requireAuthContext();
  const { data: row } = await supabase
    .from("property_items")
    .select("id, data")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();
  const existing = row as { id: string; data: Record<string, unknown> | null } | null;
  if (!existing?.data || !("pending" in existing.data)) return { error: null };
  const rest = { ...existing.data };
  delete rest.pending;
  const { error } = await supabase.from("property_items").update({ data: rest }).eq("id", existing.id);
  if (error) return { error: "Couldn't cancel just now. Try again." };
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * Save revision: the figures as checked against the notice, the date it was
 * given, and the two things the notice can't prove about itself (s72A(5),
 * s73(3)). Records a new revision (record_esp_revision, 0110), which becomes
 * the latest, drives every check and cancels the price statement approval.
 */
export async function recordEspRevision(
  propertyId: string,
  _prev: EspActionState,
  formData: FormData,
): Promise<EspActionState> {
  const { supabase } = await requireAuthContext();
  const { data: row } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();
  const data = ((row as { data?: Record<string, unknown> | null } | null)?.data ?? {}) as Record<string, unknown>;
  const pending = pendingFrom(data);
  if (!pending) return { error: "Upload the notice you gave the seller first." };
  if (pending.notRecognised) {
    return { error: "That doesn't look like a notice revising the estimated selling price. Upload the notice you gave the seller." };
  }

  const low = typedFigure(formData.get("revisedEspLow"));
  const high = typedFigure(formData.get("revisedEspHigh"));
  const givenOn = String(formData.get("noticeGivenOn") ?? "").trim();
  if (low === null || high === null) return { error: "Put in both figures from the notice." };
  if (high < low) return { error: "The higher figure is below the lower one. Check which way round they go." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(givenOn)) return { error: "Put in the date the notice was given to the seller." };

  // Typed, or changed from what was read: the record says so (26 Aug 2026).
  const enteredManually = pending.low !== low || pending.high !== high || pending.readFailed !== null;

  const evidenceProvidedBeforeNotice = formData.get("evidenceProvidedBeforeNotice") === "yes";
  const advertisingUpdated = formData.get("advertisingUpdated") === "yes";
  const outstanding = [
    evidenceProvidedBeforeNotice ? null : "Evidence of the new price has not been confirmed as given to the vendor (s72A(5)).",
    advertisingUpdated ? null : "The advertising has not been confirmed as updated to the revised price (s73(3)).",
  ].filter((o): o is string => Boolean(o));

  const { error } = await supabase.rpc("record_esp_revision", {
    p_property_id: propertyId,
    p_low: low,
    p_high: high,
    p_given_on: givenOn,
    p_notice_path: pending.path,
    p_notice_file_name: pending.fileName,
    p_entered_manually: enteredManually,
    p_method: pending.methodOfService,
    p_reason: pending.reason,
    p_card: { evidenceProvidedBeforeNotice, advertisingUpdated, outstanding },
    p_status: outstanding.length > 0 ? "open" : "done",
  });
  if (error) {
    // The database's own words where it refused; anything else, try again.
    return { error: error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't save the revision just now. Try again." };
  }

  // The price on foot has just changed: the live ad is most likely wrong now.
  try {
    const { checkListingNow } = await import("@/lib/actions/website-scan");
    await checkListingNow(propertyId);
  } catch (err) {
    console.error("advertised price recheck after an ESP revision failed:", err instanceof Error ? err.message : err);
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
