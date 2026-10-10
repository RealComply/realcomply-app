import type { SignerScope, SignoffSignature } from "@/lib/types";

// Who a sign-off document is still waiting on (10 Oct 2026).
//
// An unsigned row used to mean "waiting" for good. Two kinds of row never
// will be signed, and both were holding documents open:
//
//   - A licensee-only document (a trust reconciliation) wants ONE licensee's
//     signature, and the month counts as signed when either signs. An office
//     with two licensees in charge gives each a row, so once one signed, the
//     other was still shown, counted and badged as owing a signature on a
//     document that needed nothing more.
//   - Someone who left after a version was published can never sign it, and
//     their row kept the SG Manual at "5 of 6 signed" in amber for good.
//
// The rows themselves stay. Who was asked is part of the record; this only
// decides whether they are still being waited on.

type SignatureRow = Pick<SignoffSignature, "document_id" | "signer_id" | "signed_at">;

export type NotNeededReason = "another_licensee_signed" | "left_the_office";

/** Why an unsigned row is no longer waited on, or null if it still is (or is signed). */
export function notNeededReason(
  row: SignatureRow,
  scope: SignerScope,
  /** Every row on the same document. */
  documentRows: readonly SignatureRow[],
  /** People who have left the office (archived). */
  leftIds: ReadonlySet<string> = new Set(),
): NotNeededReason | null {
  if (row.signed_at) return null;
  if (scope === "licensee_only" && documentRows.some((r) => r.document_id === row.document_id && r.signed_at)) {
    return "another_licensee_signed";
  }
  if (leftIds.has(row.signer_id)) return "left_the_office";
  return null;
}

/** Is this row still waiting on its signer? */
export function stillWaiting(
  row: SignatureRow,
  scope: SignerScope,
  documentRows: readonly SignatureRow[],
  leftIds: ReadonlySet<string> = new Set(),
): boolean {
  return !row.signed_at && notNeededReason(row, scope, documentRows, leftIds) === null;
}

/**
 * How many documents are waiting on this person's signature: the Sign-offs
 * badge, Home and the banner on the Sign-offs page. `rows` is every row the
 * viewer can read; a licensee reads them all, so a licensee-only document a
 * fellow licensee has signed is seen as done.
 */
export function documentsWaitingOn(
  profileId: string,
  rows: readonly SignatureRow[],
  licenseeOnlyDocumentIds: ReadonlySet<string>,
): number {
  return rows.filter(
    (r) =>
      r.signer_id === profileId &&
      stillWaiting(r, licenseeOnlyDocumentIds.has(r.document_id) ? "licensee_only" : "all_staff", rows),
  ).length;
}

/**
 * People in the office with no row on an all-staff document: everyone who
 * joined before 0060 started adding new starters to the current SG Manual
 * version. Nobody has asked them to sign, so nothing shows them as missing
 * unless this does. Never anyone who has left.
 */
export function notAskedToSign<P extends { id: string; archived_at: string | null }>(
  people: readonly P[],
  documentRows: readonly Pick<SignoffSignature, "signer_id">[],
): P[] {
  const asked = new Set(documentRows.map((r) => r.signer_id));
  return people.filter((p) => !p.archived_at && !asked.has(p.id));
}

/**
 * The count a sign-off card shows: signatures given out of signatures owed.
 * Rows nobody is waiting on any more (someone who left, or a licensee-only
 * document another licensee has signed) are not counted at all, and staff
 * never asked are owed a signature, so a five-person office never reads
 * "1 of 1" (10 Oct 2026).
 */
export function signoffTally(
  rows: readonly SignatureRow[],
  scope: SignerScope,
  leftIds: ReadonlySet<string>,
  notAskedCount: number,
): { signedCount: number; total: number; allSigned: boolean } {
  // A licensee-only document needs one licensee's signature, however many
  // licensees were listed: "0 of 2" before anyone signs read as if both
  // were needed (browser re-check, 10 Oct 2026).
  if (scope === "licensee_only") {
    const signedCount = rows.some((r) => r.signed_at) ? 1 : 0;
    return { signedCount, total: 1, allSigned: signedCount === 1 };
  }
  const counted = rows.filter((r) => notNeededReason(r, scope, rows, leftIds) === null);
  const signedCount = counted.filter((r) => r.signed_at).length;
  const total = counted.length + notAskedCount;
  return { signedCount, total, allSigned: total > 0 && signedCount === total };
}
