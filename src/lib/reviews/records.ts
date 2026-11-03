import { formatAuTimestamp } from "@/lib/format-date";
import type { Complaint, Gift } from "@/lib/types";

// Who and when, for gift reviews and complaints (Adam, 3 Nov 2026; 0108).
// The database writes the names and times; this only words them. Reviews and
// resolutions from before 0108 have no name or time, and say nothing rather
// than guess.

/** The licensee's sign-off of a resolved complaint, word for word (Adam, 3 Nov 2026). */
export const COMPLAINT_SIGN_OFF_WORDS = "I've reviewed how this complaint was handled and resolved.";

const byOn = (verb: string, name: string | null | undefined, at: string | null | undefined): string | null =>
  name && at ? `${verb} by ${name}, ${formatAuTimestamp(at)}` : null;

/** "Reviewed by Lee Licensee, 3 Nov 2026", or null for a review from before 0108. */
export function giftReviewedLine(g: Pick<Gift, "status" | "reviewed_by_name" | "reviewed_at">): string | null {
  return g.status === "reviewed" ? byOn("Reviewed", g.reviewed_by_name, g.reviewed_at) : null;
}

/** Where a complaint is up to, in plain lines under its status. */
export function complaintRecordLines(
  c: Pick<
    Complaint,
    | "status"
    | "under_review_by_name"
    | "under_review_at"
    | "resolved_by_name"
    | "resolved_at"
    | "signed_off_name"
    | "signed_off_at"
  >,
): string[] {
  const lines: string[] = [];
  if (c.status !== "open") {
    const review = byOn("Under review", c.under_review_by_name, c.under_review_at);
    if (review) lines.push(review);
  }
  if (c.status === "resolved") {
    const resolved = byOn("Resolved", c.resolved_by_name, c.resolved_at);
    if (resolved) lines.push(resolved);
    const signed = byOn("Signed off", c.signed_off_name, c.signed_off_at);
    lines.push(signed ?? "Waiting for the licensee's sign-off");
  }
  return lines;
}

/** A resolved complaint the licensee hasn't signed off yet: what goes in the monthly pack. */
export function complaintAwaitsSignOff(c: Pick<Complaint, "status" | "signed_off_at">): boolean {
  return c.status === "resolved" && !c.signed_off_at;
}
