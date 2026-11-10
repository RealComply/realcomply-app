"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { addSgManualVersion } from "@/lib/actions/registers";
import { createSignoffDocument } from "@/lib/actions/signoffs";
import { createServiceClient } from "@/lib/supabase/service";
import { storedFileProblem } from "@/lib/storage/evidence";
import { advanceSgRead, type SgReadProgress } from "@/lib/sg-document/advance";
import { sgReadStore } from "@/lib/sg-document/store";
import { isSgDocType } from "@/lib/sg-document/fair-trading";

// The supervision guidelines as a live document, part 1 (Adam's mockup, 6
// Nov 2026; Master, 10 Nov 2026). Whoever runs the office (the licensee in
// charge, an office manager, an agent on their own plan) uploads, saves,
// throws a draft away and reads one again; the database checks the same
// through its four functions (0122) whatever calls them.

const NOT_YOURS = "Only the licensee in charge or an office manager can do that.";
const OLD_WORD = "Old Word files (.doc) can't be read. Save it as a Word document (.docx) or a PDF, then upload it again.";

/** The database's own plain sentence, or a general one for anything else. */
function plain(message: string | undefined, fallback: string): string {
  const m = (message ?? "").trim();
  return /^(Only |This office|That |Upload |Choose |Confirm |Keep )/.test(m) ? m : fallback;
}

const refresh = () => {
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/home");
};

/** A file already uploaded to the office's _sg-manual folder: start reading it. */
export async function startSgDocument(path: string, fileName: string): Promise<{ error: string | null; id?: string }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  const name = fileName.trim();
  if (/\.doc$/i.test(name)) return { error: OLD_WORD };
  if (!/\.(pdf|docx)$/i.test(name)) return { error: "Upload a Word (.docx) or PDF file." };
  // Never an empty or damaged file; nothing is started.
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };
  const { data, error } = await supabase.rpc("start_sg_document", { p_file_path: path, p_file_name: name });
  if (error || typeof data !== "string") return { error: plain(error?.message, "It couldn't be started just now. Try again.") };
  refresh();
  return { error: null, id: data };
}

/** Reads the next few parts, while someone waits on the page. Never more than a few minutes. */
export async function continueSgDocumentRead(id: string): Promise<SgReadProgress | { error: string }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  // Theirs to move along: their own office's, which only they can see (0122).
  const { data } = await supabase.from("sg_documents").select("id, status").eq("id", id).maybeSingle();
  if (!data) return { error: "That document isn't in this office." };
  const progress = await advanceSgRead(sgReadStore(createServiceClient()), id, { maxParts: 3, until: Date.now() + 200_000 });
  if (progress.status !== "reading" && progress.status !== "elsewhere") refresh();
  return progress;
}

/** Saves a draft as the live document, with the kind of document and the version confirmed. */
export async function saveSgDocument(id: string, docType: string, versionLabel: string): Promise<{ error: string | null }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  if (!isSgDocType(docType)) return { error: "Choose what kind of document this is." };
  const label = versionLabel.replace(/\s+/g, " ").trim();
  if (!label) return { error: "Confirm the version number." };
  const { data, error } = await supabase.rpc("save_sg_document", { p_id: id, p_doc_type: docType, p_version_label: label });
  if (error) return { error: plain(error.message, "It couldn't be saved just now. Try again.") };
  const saved = data as { new_file?: boolean; file_path?: string; file_name?: string; version_label?: string } | null;
  // A new upload is a new SG Manual version: every staff member is asked to
  // sign it, exactly as before (addSgManualVersion). Best effort: the
  // document is already saved.
  if (saved?.new_file && saved.file_path && saved.file_name) {
    await createSignoffDocument({
      category: "sg_manual",
      title: `Supervision Guidelines Manual (${saved.version_label ?? label})`,
      periodLabel: null,
      filePath: saved.file_path,
      fileName: saved.file_name,
      notes: null,
      signerScope: "all_staff",
    });
  }
  refresh();
  return { error: null };
}

/** Throws a draft away. The file it was read from stays where it is. */
export async function discardSgDocument(id: string): Promise<{ error: string | null }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  const { error } = await supabase.rpc("discard_sg_document", { p_id: id });
  if (error) return { error: plain(error.message, "It couldn't be thrown away just now. Try again.") };
  refresh();
  return { error: null };
}

/**
 * A document that can't be read, filed as it is: the current SG Manual file,
 * signed by every staff member, exactly as before part 1, just without
 * sections. Then the draft is thrown away.
 */
export async function fileSgDocumentUnread(id: string): Promise<{ error: string | null }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  const { data } = await supabase.from("sg_documents").select("file_path, file_name, status").eq("id", id).maybeSingle();
  const doc = data as { file_path: string; file_name: string; status: string } | null;
  if (!doc || doc.status !== "read_failed") return { error: "That document isn't waiting to be filed." };
  const filed = await addSgManualVersion(doc.file_path, doc.file_name, null, null);
  if (filed.error) return filed;
  await supabase.rpc("discard_sg_document", { p_id: id });
  refresh();
  return { error: null };
}

/** Reads a document again after a failed read. */
export async function retrySgDocument(id: string): Promise<{ error: string | null }> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: NOT_YOURS };
  const { error } = await supabase.rpc("retry_sg_document", { p_id: id });
  if (error) return { error: plain(error.message, "It couldn't be read again just now. Try again.") };
  refresh();
  return { error: null };
}
