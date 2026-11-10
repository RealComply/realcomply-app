// "File it without reading it" on a document that couldn't be read (part 1,
// 10 Nov 2026). Who is asked to sign (Master, 10 Nov 2026): only a new upload,
// or a new version. A manual already on file that RealComply tried to read
// (from_file_on_record) is kept as the current document as it is: staff have
// already signed that same file, so nobody is asked to sign it again.

export function fileUnreadAsksToSign(
  doc: { fromFileOnRecord: boolean; filePath: string },
  /** The office's SG Manual versions already on record, by file. */
  versionsOnRecord: string[],
): boolean {
  return !doc.fromFileOnRecord && !versionsOnRecord.includes(doc.filePath);
}

/** Under the buttons on the card: what filing it without reading does. */
export function fileUnreadSaid(fromFileOnRecord: boolean): string {
  return fromFileOnRecord
    ? "Filed without reading, your manual on file stays your current file, as it is, without sections. Staff have already signed it, so nobody is asked to sign it again."
    : "Filed without reading, it becomes your current file for staff to sign, as before, without sections.";
}
