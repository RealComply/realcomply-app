"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthContext } from "@/lib/actions/compliance";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET, storedFileProblem } from "@/lib/storage/evidence";
import { fileAcknowledgementPdf } from "@/lib/agent-acknowledgement-file";
import { ACK_STATEMENTS, ACK_STATEMENT_TEXTS, ACK_VERSION, ackProblem, tidy } from "@/lib/agent-acknowledgement";

// The "Before you start" screen and the signed annexure upload, for an agent
// on their own plan (job 7 brief, Parts 1 to 3; 0071). RealComply never emails
// or contacts the agent's licensee from either.

export type AckState = { error: string | null };

/**
 * "Confirm and continue". The words stored are the ones on the screen, taken
 * from lib/agent-acknowledgement.ts here rather than from the form, so what is
 * recorded is what was shown. A second press gets the first record back
 * (0071), and the PDF is filed once.
 */
export async function confirmAgentAcknowledgement(_prev: AckState, formData: FormData): Promise<AckState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.worksAsAgentPlan || !access.actsAsLicensee) {
    return { error: "Only the agent on their own plan confirms this." };
  }

  const fields = {
    agentLicenceNumber: tidy(formData.get("agentLicenceNumber")),
    agencyName: tidy(formData.get("agencyName")),
    licenseeName: tidy(formData.get("licenseeName")),
    licenseeLicenceNumber: tidy(formData.get("licenseeLicenceNumber")),
    typedName: tidy(formData.get("typedName")),
  };
  const ticked = ACK_STATEMENTS.map((_, i) => formData.get(`tick${i}`) === "yes");
  const problem = ackProblem(fields, ticked);
  if (problem) return { error: problem };

  const { data, error } = await supabase.rpc("record_agent_acknowledgement", {
    p_agent_licence_number: fields.agentLicenceNumber,
    p_agency_name: fields.agencyName,
    p_licensee_name: fields.licenseeName,
    p_licensee_licence_number: fields.licenseeLicenceNumber,
    p_typed_name: fields.typedName,
    p_wording_version: ACK_VERSION,
    p_wording: ACK_STATEMENT_TEXTS,
  });
  if (error || typeof data !== "string") {
    console.error("confirmAgentAcknowledgement:", error?.message);
    return { error: "That didn’t save. Check every field and try again." };
  }

  await fileAcknowledgementPdf(createServiceClient(), data);
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/home");
}

export type UploadState = { error: string | null; done?: boolean };

/**
 * Files the signed annexure after the browser has put it in the office's
 * _signoffs folder. The database checks it is there, in this office's folder,
 * and a PDF, JPG or PNG within the size limit (0071). A file it refuses is
 * removed again.
 */
export async function recordSignedAnnexure(path: string, fileName: string): Promise<UploadState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.worksAsAgentPlan || !access.actsAsLicensee) {
    return { error: "Only the agent on their own plan uploads the signed annexure." };
  }
  // Never an empty annexure on file (19 Oct 2026). Removed like any upload
  // the database refuses; nothing is filed.
  const empty = await storedFileProblem(supabase, String(path ?? ""));
  if (empty) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([String(path ?? "")]);
    return { error: empty };
  }
  const { error } = await supabase.rpc("record_signed_annexure_upload", {
    p_path: String(path ?? ""),
    p_file_name: tidy(fileName).slice(0, 255) || "signed-annexure",
  });
  if (error) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([String(path ?? "")]);
    // The database's reasons are written for people ("Upload a PDF, JPG or PNG.").
    return { error: error.message || "The upload didn’t save. Try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { error: null, done: true };
}
