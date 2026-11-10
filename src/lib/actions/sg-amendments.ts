"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { isSgAmendmentReason } from "@/lib/sg-document/amendments";

// Quick amendments to the live supervision guidelines, and each person's
// sign-off of a change (Adam's mockup, screens 3 and 6; 0125). The database
// checks who may and takes the wording being replaced from the document as
// it stands; these only pass the person's choices on, in plain text.

export type SgAmendmentState = { error: string | null; id?: string | null };

export type SgAmendmentInput = {
  /** The draft being saved again, or null for a new one. */
  id: string | null;
  documentId: string;
  sectionPosition: number;
  paragraphIndex: number;
  newText: string;
  reason: string;
  reasonOther: string;
  startsOn: string;
  approve: boolean;
};

/** Plain text: control characters out (line breaks kept), spaces tidied, ends trimmed. */
function plain(typed: string, keepLines: boolean): string {
  const s = String(typed ?? "").replace(/\r\n?/g, "\n");
  const noControl = s.replace(keepLines ? /[\u0000-\u0009\u000b-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ");
  return (keepLines ? noControl.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : noControl.replace(/\s+/g, " ")).trim();
}

function refusal(error: { code?: string; message: string }, otherwise: string): string {
  return error.code === "P0001" || error.code === "42501" ? error.message : otherwise;
}

function refresh() {
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/home");
}

export async function saveSgAmendment(input: SgAmendmentInput): Promise<SgAmendmentState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: "Only the licensee in charge or an office manager can amend the supervision guidelines." };
  const newText = plain(input.newText, true);
  if (!newText) return { error: "Write the new wording." };
  if (!isSgAmendmentReason(input.reason)) return { error: "Choose the reason." };
  const reasonOther = plain(input.reasonOther, false);
  if (input.reason === "other" && !reasonOther) return { error: "Say what the other reason is." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || Number.isNaN(Date.parse(`${input.startsOn}T00:00:00Z`))) {
    return { error: "Give the date it starts." };
  }
  if (!Number.isInteger(input.sectionPosition) || !Number.isInteger(input.paragraphIndex)) return { error: "Choose the paragraph to amend." };
  const { data, error } = await supabase.rpc("save_sg_amendment", {
    p_id: input.id,
    p_document_id: input.documentId,
    p_section_position: input.sectionPosition,
    p_paragraph_index: input.paragraphIndex,
    p_new_text: newText,
    p_reason: input.reason,
    p_reason_other: input.reason === "other" ? reasonOther : null,
    p_starts_on: input.startsOn,
    p_approve: input.approve,
  });
  if (error) return { error: refusal(error, "Couldn't save the amendment just now. Try again.") };
  refresh();
  return { error: null, id: typeof data === "string" ? data : null };
}

export async function discardSgAmendment(id: string): Promise<SgAmendmentState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: "Only the licensee in charge or an office manager can do that." };
  const { error } = await supabase.rpc("discard_sg_amendment", { p_id: id });
  if (error) return { error: refusal(error, "Couldn't throw the draft away just now. Try again.") };
  refresh();
  return { error: null };
}

/** "I've read and understood this change": each person for themselves. */
export async function signSgAmendment(id: string): Promise<SgAmendmentState> {
  const { supabase } = await requireAuthContext();
  const { error } = await supabase.rpc("sign_sg_amendment", { p_id: id });
  if (error) return { error: refusal(error, "Couldn't record that just now. Try again.") };
  refresh();
  return { error: null };
}
