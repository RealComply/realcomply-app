// A listing sign-off (sign_agent, sign_licensee) as recorded on its card,
// whichever way it was given.
//
// Signed in the app (signItem in lib/actions/compliance.ts), the card holds
// typedName and signedAt. Signed through the emailed link (submit_signoff,
// migration 0014), it holds signedName and signoffRequestId, and the time is
// on the request (property_signoff_requests.signed_at).
//
// The audit pack and the summary read typedName only, so a file the licensee
// signed by link printed as "Compliance record - DRAFT" with "Not yet signed"
// in the licensee's block, while the app had already closed it out on that
// same signature (10 Oct 2026). Every reader of a sign-off goes through here.

export type ListingSignature = { typedName: string; signedAt: string | null };

type SignatureData = {
  typedName?: unknown;
  signedName?: unknown;
  signedAt?: unknown;
  signoffRequestId?: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The signature on a sign-off card, or null when nobody has signed it.
 * linkSignedAt is the sign-off request's signed_at, for a link signature,
 * which carries no time of its own.
 */
export function listingSignature(data: unknown, linkSignedAt?: string | null): ListingSignature | null {
  const d = (data ?? {}) as SignatureData;
  const typedName = text(d.typedName) ?? text(d.signedName);
  if (!typedName) return null;
  return { typedName, signedAt: text(d.signedAt) ?? linkSignedAt ?? null };
}

/** The sign-off request a link signature came from, when it was given by link and has no time of its own. */
export function linkRequestNeedingTime(data: unknown): string | null {
  const d = (data ?? {}) as SignatureData;
  return text(d.signedAt) ? null : text(d.signoffRequestId);
}
