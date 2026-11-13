"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { reviewNoteProblem } from "@/lib/sg-document/annual-review";

// "Reviewed, no changes needed" on the live supervision guidelines (Adam's
// mockup, screen 7; 0126). The licensee in charge or an office manager. The
// database checks who may, that it's the office's live document and that it
// hasn't been marked reviewed today; this passes the note on as plain text.
// It moves the next review 12 months on and goes in the change log.

export type SgReviewState = { error: string | null; done?: boolean };

export async function markSgReviewed(input: { documentId: string; note: string }): Promise<SgReviewState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: "Only the licensee in charge or an office manager can record the review." };
  const note = String(input.note ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const problem = reviewNoteProblem(note);
  if (problem) return { error: problem };
  const { error } = await supabase.rpc("record_sg_review", { p_document_id: input.documentId, p_note: note || null });
  if (error) {
    return {
      error:
        error.code === "P0001" || error.code === "42501"
          ? error.message
          : "The review couldn't be recorded. Try again in a minute.",
    };
  }
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/home");
  return { error: null, done: true };
}
