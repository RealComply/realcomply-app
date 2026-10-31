"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET, complaintFolder, isInFolder, storedFileInfo, storedFileProblem } from "@/lib/storage/evidence";
import { complaintFileDisplayName } from "@/lib/complaint-files";

// Files on a complaint (0101; the REVERSAL of 16 Oct 2026 is in
// lib/complaint-files.ts). The browser uploads the file straight to Storage,
// into the complaint's own folder ({office}/_complaints/{complaint}/), as every
// upload in the app does (lib/storage/evidence.ts on why); these record it.
// The licensee in charge only, like complaints themselves (Adam, 9 Oct 2026):
// checked here, and enforced by the database and Storage whatever calls them.
// No AI reading of these files.

export type ComplaintFileResult = { error: string | null };

/** Records a file the licensee has just uploaded to one of their complaints. */
export async function addComplaintFile(
  complaintId: string,
  path: string,
  fileName: string,
): Promise<ComplaintFileResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.officeLicensee) return { error: "Complaints go to the licensee in charge." };

  const { data: complaint } = await supabase
    .from("complaints")
    .select("id")
    .eq("id", complaintId)
    .eq("agency_id", profile.agency_id)
    .maybeSingle();
  if (!complaint) return { error: "That complaint isn't on your register." };

  // The folder check, as for every other upload: only this complaint's own
  // folder in this office (the database refuses anything else too).
  if (!isInFolder(path, complaintFolder(profile.agency_id, complaintId))) {
    return { error: "Couldn't attach that file just now, and nothing was changed. Try again." };
  }

  const bucket = supabase.storage.from(EVIDENCE_BUCKET);
  // Empty, or won't open (19 Oct 2026): refused, and what landed is taken
  // away again, so nothing sits in the folder unrecorded.
  const problem = await storedFileProblem(supabase, path);
  if (problem) {
    await bucket.remove([path]);
    return { error: problem };
  }

  const info = await storedFileInfo(supabase, path);
  const { error } = await supabase.from("complaint_files").insert({
    agency_id: profile.agency_id,
    complaint_id: complaintId,
    file_path: path,
    file_name: complaintFileDisplayName(fileName),
    size_bytes: info?.size ?? null,
  });
  if (error) {
    console.error("complaint file not recorded:", complaintFolder(profile.agency_id, complaintId), error.message);
    await bucket.remove([path]);
    return { error: "Couldn't attach that file just now, and nothing was changed. Try again." };
  }

  revalidatePath("/dashboard/registers");
  return { error: null };
}

/**
 * Takes a file off a complaint. The removal is recorded first (who and when,
 * stamped by the database from the login and its own clock), then the stored
 * file is deleted. Never the other way round: a file deleted before its
 * removal was recorded would be gone without a trace if the record failed.
 */
export async function removeComplaintFile(fileId: string): Promise<ComplaintFileResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.officeLicensee) return { error: "Only the licensee in charge can remove a complaint's files." };

  const { data: row } = await supabase
    .from("complaint_files")
    .select("id, complaint_id, file_path, removed_at")
    .eq("id", fileId)
    .eq("agency_id", profile.agency_id)
    .maybeSingle();
  if (!row) return { error: "That file isn't on your register." };
  const file = row as { id: string; complaint_id: string | null; file_path: string; removed_at: string | null };
  if (file.removed_at) {
    revalidatePath("/dashboard/registers");
    return { error: null };
  }

  const { data: stamped, error } = await supabase
    .from("complaint_files")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", fileId)
    .is("removed_at", null)
    .select("removed_at");
  if (error || !(stamped ?? []).some((r: { removed_at: string | null }) => r.removed_at)) {
    return { error: "Couldn't remove that file just now, and nothing was changed. Try again." };
  }

  // Only from its own complaint's folder, as for every other removal.
  const folder = file.complaint_id ? complaintFolder(profile.agency_id, file.complaint_id) : null;
  if (folder && isInFolder(file.file_path, folder)) {
    const { data: gone, error: removeError } = await supabase.storage.from(EVIDENCE_BUCKET).remove([file.file_path]);
    if (removeError || (gone ?? []).length === 0) {
      // The folder only, never the file's name.
      console.error("removed complaint file not deleted from storage:", folder, removeError?.message ?? "nothing deleted");
      revalidatePath("/dashboard/registers");
      return { error: "Removed from the complaint and recorded, but the file itself couldn't be deleted just now." };
    }
  }

  revalidatePath("/dashboard/registers");
  return { error: null };
}
