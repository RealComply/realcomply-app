import { formatAuTimestamp } from "@/lib/format-date";
import { listingSignature } from "@/lib/rules/listing-signature";
import { priceApproval } from "@/lib/rules/price-statement";

// Reopening cards on a sales listing (Adam, 28 Oct 2026).
//
// WAS: some cards could not be reopened at all (the price statement approval,
// the signatures, the advertised price guide, the final sale price, the
// auction cards and others), and a file the licensee had signed off stayed
// signed whatever happened to its cards afterwards. The covering letter date
// rule of 20 Oct 2026 is an example: it kept the received date "as signed"
// on a signed-off file, while every other card on that file could still be
// changed underneath the signature.
//
// NOW:
//   1. Every card can be reopened, in every stage, by anyone who can work
//      the listing. Who and when go on the card; everything on it stays.
//   2. Reopening the ESP card, the ESP reasoning card, or the ESP revision
//      while it holds the revised ESP (or the ESP on the file changing)
//      cancels the licensee's price statement approval. It is kept, marked
//      cancelled, b4 goes back to open saying why, and every approval link
//      for it stops. The licensee approves again the usual way.
//   3. Only the licensee in charge reopens the licensee's own sign-off cards:
//      the price statement approval (b4) and their signature.
//   4. A signed-off file can't be changed by anyone. The licensee in charge
//      reopens a card, which cancels the file sign-off (kept, marked
//      cancelled); anyone else can ask the licensee to, with a reason.
//   5. The database enforces all of it (0100); this file holds the words and
//      the small rules the page uses to show them.

export const ONLY_LICENSEE_SIGNOFF = "Only the licensee in charge can reopen a licensee sign-off.";
export const ONLY_LICENSEE_SIGNED_FILE = "Only the licensee can reopen a signed-off file.";
/** The database's words when the licensee hasn't confirmed yet (0100). */
export const CANCELS_SIGNOFF = "Reopening this card cancels the file sign-off. The file will need signing off again.";
export const CONFIRM_CANCEL_SIGNOFF = `${CANCELS_SIGNOFF} Reopen?`;

/** The licensee's own sign-off cards. */
export const LICENSEE_SIGNOFF_KEYS: ReadonlySet<string> = new Set(["b4", "sign_licensee"]);

/** No Reopen of its own: it goes back to not generated when the sign-off is cancelled. */
export const NO_REOPEN_KEYS: ReadonlySet<string> = new Set(["f2"]);

/**
 * Cards that work out their own status from what is on them, so after a
 * reopen with nothing to change they need a "Mark done" to close again: the
 * offers log, the building/pest/strata reports and the Power of Attorney
 * copy. (The Power of Attorney question takes its answer again instead.)
 */
export const MARK_DONE_AGAIN_KEYS: ReadonlySet<string> = new Set(["d2", "f3", "poa_doc"]);

type CardShape = { key: string; kind: string };

/**
 * Whether the card's own body already carries a Reopen (or "Change answer")
 * on a file that isn't signed off: the ordinary checklist cards and the ESP
 * revision. Every other card gets the shared Reopen under its body.
 */
export function hasOwnReopen(card: CardShape): boolean {
  return (card.kind === "checklist" && card.key !== "b4") || card.kind === "reduction";
}

/** A card with something to reopen. */
export function isReopenable(card: CardShape, status: string | null | undefined): boolean {
  if (NO_REOPEN_KEYS.has(card.key)) return false;
  return status === "done" || status === "flagged";
}

/**
 * Whether the shared Reopen shows under this card. On a signed-off file it
 * stands in for every card's own (the card's controls are locked); otherwise
 * only on cards without one.
 */
export function showsSharedReopen(card: CardShape, status: string | null | undefined, signedOff: boolean): boolean {
  if (!isReopenable(card, status)) return false;
  return signedOff || !hasOwnReopen(card);
}

export type ReopenWhy = "reopened" | "esp_changed" | "withdrawn" | "file_reopened";

function quoted(title: string): string {
  return `“${title}”`;
}

/** Under a card someone reopened: "Reopened by Ana Agent, 28 October 2026." */
export function reopenedLine(name: string, at: string): string {
  return `Reopened by ${name}, ${formatAuTimestamp(at)}.`;
}

/** On b4 after its approval was cancelled. */
export function priceApprovalReopenedLine(args: {
  name: string;
  at: string;
  why: ReopenWhy | null;
  becauseTitle: string | null;
}): string {
  const head = `Reopened by ${args.name}, ${formatAuTimestamp(args.at)}`;
  if (args.why === "reopened" && args.becauseTitle) {
    return `${head}, because ${quoted(args.becauseTitle)} was reopened. The licensee needs to approve again.`;
  }
  if (args.why === "esp_changed") {
    return `${head}, because the ESP on the file changed. The licensee needs to approve again.`;
  }
  return `${head}. The licensee needs to approve again.`;
}

/** On the signature cards after the file sign-off was cancelled. */
export function fileSignoffCancelledLine(args: { name: string; at: string; becauseTitle: string | null }): string {
  const head = `File sign-off cancelled by ${args.name}, ${formatAuTimestamp(args.at)}`;
  return args.becauseTitle
    ? `${head}, because ${quoted(args.becauseTitle)} was reopened. The file needs signing off again.`
    : `${head}. The file needs signing off again.`;
}

export type Cancellation = {
  id: string;
  itemKey: "b4" | "sign_agent" | "sign_licensee";
  card: { status?: string | null; data?: unknown; completed_by?: string | null };
  cancelledAt: string;
  cancelledBy: string | null;
  becauseItemKey: string | null;
  because: ReopenWhy;
};

/**
 * One cancelled approval or signature, as the card's history shows it:
 * what was given, by whom and when, then when and why it was cancelled.
 */
export function cancellationLine(
  c: Cancellation,
  names: (id: string | null) => string,
  title: (key: string) => string,
): string {
  let given: string;
  if (c.itemKey === "b4") {
    const approval = priceApproval({ ...c.card, status: "done" }, undefined);
    const by = approval?.name ?? names(approval?.via === "app" ? (c.card.completed_by ?? null) : null);
    const when = approval?.at ? ` on ${formatAuTimestamp(approval.at)}` : "";
    const how = approval?.via === "link" ? " by email" : "";
    const words = approval?.text ? `: ${quoted(approval.text)}` : "";
    given = `Approved by ${by}${when}${how}${words}.`;
  } else {
    const signature = listingSignature(c.card.data);
    const by = signature?.typedName ?? names(c.card.completed_by ?? null);
    const when = signature?.signedAt ? ` on ${formatAuTimestamp(signature.signedAt)}` : "";
    given = `Signed by ${by}${when}.`;
  }
  const cancelled = `Cancelled ${formatAuTimestamp(c.cancelledAt)} by ${names(c.cancelledBy)}`;
  if (c.because === "esp_changed") return `${given} ${cancelled}, because the ESP on the file changed.`;
  if (c.becauseItemKey && c.because !== "withdrawn") {
    return `${given} ${cancelled}, because ${quoted(title(c.becauseItemKey))} was reopened.`;
  }
  return `${given} ${cancelled}.`;
}

export type ReopenRequest = {
  id: string;
  itemKey: string;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  status: "waiting" | "reopened" | "declined";
  answeredBy: string | null;
  answeredAt: string | null;
};

/** The request to show on a card: the waiting one, else the latest answered. */
export function requestFor(requests: ReopenRequest[], itemKey: string): ReopenRequest | null {
  const mine = requests.filter((r) => r.itemKey === itemKey);
  const waiting = mine.find((r) => r.status === "waiting");
  if (waiting) return waiting;
  return [...mine].sort((a, b) => (b.requestedAt > a.requestedAt ? 1 : -1))[0] ?? null;
}

/** The line about a request, worded for whoever is looking. */
export function requestLine(
  r: ReopenRequest,
  viewer: { id: string; isLicensee: boolean },
  names: (id: string | null) => string,
): string {
  const when = formatAuTimestamp(r.requestedAt);
  // The reason goes last, in their words, so nothing is added after it.
  if (r.status === "waiting") {
    if (r.requestedBy === viewer.id) {
      return `You asked the licensee to reopen this on ${when}. Waiting on the licensee. Your reason: ${quoted(r.reason)}`;
    }
    if (viewer.isLicensee) {
      return `${names(r.requestedBy)} asked you to reopen this card on ${when}. Their reason: ${quoted(r.reason)}`;
    }
    return `${names(r.requestedBy)} asked the licensee to reopen this on ${when}. Their reason: ${quoted(r.reason)}`;
  }
  if (r.status === "declined") {
    return `The licensee declined the request to reopen this on ${formatAuTimestamp(r.answeredAt)}.`;
  }
  return `The licensee reopened the file on ${formatAuTimestamp(r.answeredAt)}.`;
}

/** The longest reason a request takes. The database refuses longer (0100). */
export const REOPEN_REASON_MAX = 500;
