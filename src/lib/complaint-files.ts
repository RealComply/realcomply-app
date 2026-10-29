import type { ComplaintFile } from "@/lib/types";
import { formatAuDateTimeShort } from "@/lib/format-date";

// Files on a complaint (0101).
//
// REVERSAL (Adam, 30 Oct 2026). Was (16 Oct 2026): no uploads for Breaches or
// Complaints; a complaint email is copied and pasted into the entry. Now:
// complaints can have files (the complaint email, letters, photos, the outcome
// letter), as many as needed, added at any time while the complaint is open or
// after. Breaches stay notes only. The same people who see complaints see and
// add them: the licensee in charge (decided 9 Oct 2026). Removing one is the
// licensee's too, and every removal is recorded: who, when and the file's
// name. Nothing is deleted silently. No AI reading of these files.
//
// What is said about them, in one place, so the register, its export and the
// audit pack say the same thing.

/** A complaint's files: those on it now, and those removed. Each oldest first. */
export function complaintFilesFor(
  complaintId: string,
  files: ComplaintFile[],
): { current: ComplaintFile[]; removed: ComplaintFile[] } {
  const mine = files
    .filter((f) => f.complaint_id === complaintId)
    .sort((a, b) => a.added_at.localeCompare(b.added_at));
  return { current: mine.filter((f) => !f.removed_at), removed: mine.filter((f) => f.removed_at) };
}

/**
 * Files removed from a complaint that has since been deleted. Their record
 * stays (the database keeps every removal), with no complaint to show it under.
 */
export function filesOfDeletedComplaints(files: ComplaintFile[]): ComplaintFile[] {
  return files.filter((f) => f.complaint_id === null).sort((a, b) => a.added_at.localeCompare(b.added_at));
}

function who(id: string | null, nameOf: Record<string, string>): string {
  return (id && nameOf[id]) || "someone no longer in the office";
}

/** "Added 30 Oct 2026, 2:14 pm by Jordan Ellis" (Sydney time). */
export function addedLine(f: ComplaintFile, nameOf: Record<string, string>): string {
  return `Added ${formatAuDateTimeShort(f.added_at)} by ${who(f.added_by, nameOf)}`;
}

/** "Removed 30 Oct 2026, 2:20 pm by Jordan Ellis" (Sydney time), or "" while it is still on. */
export function removedLine(f: ComplaintFile, nameOf: Record<string, string>): string {
  return f.removed_at ? `Removed ${formatAuDateTimeShort(f.removed_at)} by ${who(f.removed_by, nameOf)}` : "";
}

/**
 * The name kept on the record: the file's name as chosen, on one line, and no
 * longer than the database keeps (300 characters).
 */
export function complaintFileDisplayName(name: string): string {
  const oneLine = name.replace(/\s+/g, " ").trim();
  if (!oneLine) return "file";
  if (oneLine.length <= 300) return oneLine;
  // Keep the end: the extension says what kind of file it is.
  const dot = oneLine.lastIndexOf(".");
  const ext = dot > 0 && oneLine.length - dot <= 10 ? oneLine.slice(dot) : "";
  return `${oneLine.slice(0, 300 - ext.length - 1)}…${ext}`;
}

/** "2 KB", "4.1 MB". Empty when the size isn't known. */
export function fileSizeLabel(bytes: number | null): string {
  if (bytes === null || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
