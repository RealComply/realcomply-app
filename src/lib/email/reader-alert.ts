import { formatAuDateTimeShort } from "@/lib/format-date";
import type { ReadFailureWhy } from "@/lib/documents/read-core";
import { READERS, type ReaderAlert } from "@/lib/documents/read-record";
import { sendEmail } from "@/lib/email/send";

// Adam's same-day alert when a document read fails, or a comparable-sales
// report gives 0 comparables (Adam, 1 Nov 2026). To Adam only
// (ADMIN_NOTIFICATION_EMAIL), never to the office. Names the office, the
// listing, the card and the file, as asked. At most one a day per listing:
// lib/documents/read-record and supabase/migrations/0103 decide when.

/** What happened, for Adam: plain, and a little more exact than the card. */
const WHAT_HAPPENED: Record<ReadFailureWhy, string> = {
  cut_off: "The reader's answer hit its length limit and was cut off, so nothing was taken from the file.",
  unparseable: "The reader's answer couldn't be used (it wasn't in the shape asked for), so nothing was taken from the file.",
  refused: "The reader declined to answer, so nothing was taken from the file.",
  no_answer: "The reader gave no answer, so nothing was taken from the file.",
  too_large: "The file is too large for the reader, so nothing was taken from it.",
  unsupported: "The file is a kind the reader can't take, so nothing was taken from it.",
  file: "The file couldn't be opened (the download failed, or it is empty or damaged), so nothing was taken from it.",
  service: "The AI service returned an error (busy, overloaded or down), so nothing was taken from the file.",
  other:
    "Something else went wrong, so nothing was taken from the file. Vercel's logs have the detail: search for \"document read failed\".",
};

export function readerAlertEmail(a: ReaderAlert): { subject: string; text: string } {
  const what = READERS[a.reader];
  const where = a.listing ?? a.office;
  const zeroComparables = a.outcome !== "failed";
  const subject = zeroComparables
    ? `RealComply alert: a comparable-sales report gave 0 comparables (${where})`
    : `RealComply alert: a ${what} couldn't be read (${where})`;

  const happened = zeroComparables
    ? a.outcome === "wrong_document"
      ? "The file on the card isn't a comparable-sales report, so no comparables were taken from it. The card tells the agent to replace it."
      : "The read finished, but no comparable sales were taken from the report. Either it has none, or the reader missed them: worth opening the file to see."
    : WHAT_HAPPENED[a.why ?? "other"];

  const once = a.listing
    ? "This is the only email about this listing today. Any more failed reads on it today are recorded, not emailed."
    : `This is the only email about ${what} reads in this office today. Any more today are recorded, not emailed.`;

  const text = [
    zeroComparables ? "A comparable-sales report was read and gave 0 comparables." : `A ${what} couldn't be read.`,
    "",
    `Office: ${a.office}`,
    `Listing: ${a.listing ?? "none (not a listing document)"}`,
    `Card: ${a.card}`,
    `File: ${a.fileName}`,
    `When: ${formatAuDateTimeShort(a.at.toISOString())} (Sydney)`,
    "",
    `What happened: ${happened}`,
    zeroComparables ? "" : "The card says so, and nothing from the file was put on it.",
    "",
    once,
    "Monday's staff email counts the week's reads.",
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  return { subject, text };
}

/** Emails Adam the alert. False when it couldn't be sent (and why is logged). */
export async function sendReaderAlert(a: ReaderAlert): Promise<boolean> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("reader alert not emailed: ADMIN_NOTIFICATION_EMAIL is not set.", a.reader, a.outcome, a.why);
    return false;
  }
  return sendEmail({ to, ...readerAlertEmail(a) });
}
