"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET, isInFolder, storedFileProblem } from "@/lib/storage/evidence";
import { createServiceClient } from "@/lib/supabase/service";
import { readNoticeIntoPending } from "@/lib/esp-notice";
import { noticeUnderReforms, pendingFrom, previousEspProblem, revisionEvidenceProblem, typedFigure } from "@/lib/esp-history";
import { feedbackToStore, marketFeedbackFrom } from "@/lib/rules/market-feedback";
import { espRevisionsFor } from "@/lib/data/esp-revisions";
import { comparablesFor } from "@/lib/data/comparables";
import { MAX_MOST_COMPARABLE } from "@/lib/rules/comparables-rules";
import { previousAddresses, revisionComparablesFrom, revisionComparablesProblem } from "@/lib/rules/revision-comparables";

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
 *
 * With each revision (0117; Adam, 9 Nov 2026: "check the old ESP and attach
 * the evidence"): the ESP before it as the notice states it, and the evidence
 * given to the seller, a file in the listing's d3 folder or part of the
 * notice. For a notice given from 17 November: no evidence, no save, since a
 * revision can't be changed once recorded; no ESP before it on the notice,
 * the card stays open until a notice that states it is added.
 */
export async function recordEspRevision(
  propertyId: string,
  _prev: EspActionState,
  formData: FormData,
): Promise<EspActionState> {
  const { supabase, profile } = await requireAuthContext();
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

  const previousLow = typedFigure(formData.get("previousEspLow"));
  const previousHigh = typedFigure(formData.get("previousEspHigh"));
  if ((previousLow === null) !== (previousHigh === null)) {
    return { error: "Put in both figures for the ESP before the revision, or leave both empty." };
  }
  if (previousLow !== null && previousHigh !== null && previousHigh < previousLow) {
    return { error: "In the ESP before the revision, the higher figure is below the lower one. Check which way round they go." };
  }

  const evidencePath = String(formData.get("evidencePath") ?? "").trim() || null;
  const evidenceFileName = String(formData.get("evidenceFileName") ?? "").trim() || null;
  const evidenceInNotice = formData.get("evidenceInNotice") === "yes";
  if (evidencePath) {
    if (!isInFolder(evidencePath, `${profile.agency_id}/${propertyId}/d3`)) return { error: "Upload the evidence again." };
    const empty = await storedFileProblem(supabase, evidencePath);
    if (empty) return { error: empty };
  }
  const noEvidence = revisionEvidenceProblem({ evidencePath, inNotice: evidenceInNotice, givenOn });
  if (noEvidence) return { error: noEvidence };

  // The market feedback it responded to, when it did (Reg s12G(1)(f)): typed,
  // a record of it attached, where it's kept (the CRM), or any mix (Adam,
  // 9 Nov 2026). The record goes up to the listing's d3 folder, as the evidence does.
  const feedbackTicked = formData.get("marketFeedbackTicked") === "yes";
  const feedbackFilePath = feedbackTicked ? String(formData.get("feedbackFilePath") ?? "").trim() || null : null;
  if (feedbackFilePath) {
    if (!isInFolder(feedbackFilePath, `${profile.agency_id}/${propertyId}/d3`)) return { error: "Upload the feedback record again." };
    const empty = await storedFileProblem(supabase, feedbackFilePath);
    if (empty) return { error: empty };
  }
  const feedback = marketFeedbackFrom(formData.get("marketFeedback"), feedbackTicked, {
    file: feedbackFilePath
      ? { path: feedbackFilePath, name: String(formData.get("feedbackFileName") ?? "").trim() || "Market feedback" }
      : null,
    elsewhere: formData.get("feedbackElsewhere") === "yes",
    where: String(formData.get("feedbackWhere") ?? ""),
    confirmed: formData.get("feedbackElsewhereConfirmed") === "yes",
  });
  if ("error" in feedback) return { error: feedback.error };

  // Its own comparable sales (Reg s12G(1)(a), (c), (d); 0120): which were
  // taken into account, the 3 most comparable and why, why any sale new since
  // the previous ESP wasn't used then, the information used, and why fewer
  // than 3. What counts as "the previous ESP's" is worked out here, not taken
  // from the form.
  const comparables = revisionComparablesFrom(formData.get("revisionComparables"));
  if ("error" in comparables) return { error: comparables.error };
  const comparablesInfoUsed = String(formData.get("comparablesInfoUsed") ?? "").trim().slice(0, 4000) || null;
  const mostCount = comparables.entries.filter((c) => c.most).length;
  const comparablesFewerReason =
    mostCount < MAX_MOST_COMPARABLE ? String(formData.get("comparablesFewerReason") ?? "").trim().slice(0, 4000) || null : null;
  const earlier = await espRevisionsFor(supabase, profile.agency_id, propertyId);
  const firstEsp = (await comparablesFor(supabase, propertyId)).filter((c) => c.weighting === "relied").map((c) => c.address);
  const comparablesProblem = revisionComparablesProblem({
    entries: comparables.entries,
    previousAddresses: previousAddresses(earlier, firstEsp),
    infoUsed: comparablesInfoUsed,
    fewerReason: comparablesFewerReason,
    underReforms: noticeUnderReforms(givenOn),
  });
  if (comparablesProblem) return { error: comparablesProblem };

  // Typed, or changed from what was read: the record says so (26 Aug 2026).
  const enteredManually = pending.low !== low || pending.high !== high || pending.readFailed !== null;

  const evidenceProvidedBeforeNotice = formData.get("evidenceProvidedBeforeNotice") === "yes";
  const advertisingUpdated = formData.get("advertisingUpdated") === "yes";
  // What only a new notice can fix: kept through the two ticks below (confirmEspRevision).
  const noticeProblems = [previousEspProblem({ low: previousLow, high: previousHigh }, givenOn)].filter(
    (o): o is string => Boolean(o),
  );
  const outstanding = [
    evidenceProvidedBeforeNotice ? null : "Evidence of the new price has not been confirmed as given to the vendor (s72A(5)).",
    advertisingUpdated ? null : "The advertising has not been confirmed as updated to the revised price (s73(3)).",
    ...noticeProblems,
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
    p_card: { evidenceProvidedBeforeNotice, advertisingUpdated, outstanding, noticeProblems },
    p_status: outstanding.length > 0 ? "open" : "done",
    p_previous_low: previousLow,
    p_previous_high: previousHigh,
    p_evidence_path: evidencePath,
    p_evidence_file_name: evidencePath ? evidenceFileName : null,
    p_evidence_in_notice: evidenceInNotice,
    // The market feedback it responded to (Reg s12G(1)(f)).
    p_market_feedback: feedbackToStore(feedback),
    // Its own comparable sales (Reg s12G(1)(a), (c), (d); 0120).
    p_comparables: comparables.entries,
    p_comparables_info_used: comparablesInfoUsed,
    p_comparables_fewer_reason: comparablesFewerReason,
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

/**
 * Delete a revision (Adam, 10 Nov 2026: "Just have it deleted cleanly";
 * 0124). The database checks it's the listing's agent or the licensee in
 * charge, deletes it, moves the later ones up a number and moves the card,
 * then hands back the files that went with it. Those are removed here, and
 * only from this listing's own ESP revision folder: the person may not
 * otherwise delete files (only the licensee can, 0058), so the removal is
 * RealComply's, after the database has agreed.
 */
export async function deleteEspRevision(propertyId: string, revisionNo: number): Promise<EspActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!Number.isInteger(revisionNo) || revisionNo < 1) return { error: "That revision isn't on this listing. Reload the page." };
  const { data, error } = await supabase.rpc("delete_esp_revision", { p_property_id: propertyId, p_revision_no: revisionNo });
  if (error) {
    return { error: error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't delete the revision just now. Try again." };
  }
  const folder = `${profile.agency_id}/${propertyId}/d3`;
  const paths = (Array.isArray(data) ? (data as unknown[]) : []).filter(
    (p): p is string => typeof p === "string" && isInFolder(p, folder),
  );
  if (paths.length > 0) {
    try {
      const { error: removeError } = await createServiceClient().storage.from(EVIDENCE_BUCKET).remove(paths);
      // The folder only, never a file's name.
      if (removeError) console.error("deleted ESP revision's files not removed:", folder, removeError.message);
    } catch (err) {
      console.error("deleted ESP revision's files not removed:", folder, err instanceof Error ? err.message : err);
    }
  }

  // The ESP on file may have changed: check the live ad against it again.
  try {
    const { checkListingNow } = await import("@/lib/actions/website-scan");
    await checkListingNow(propertyId);
  } catch (err) {
    console.error("advertised price recheck after an ESP revision was deleted failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
