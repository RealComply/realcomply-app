// The read, held with the name question until it is answered (15 Oct 2026).
// Server only: it signs with a server secret. The rule itself is in
// lib/licence-name.ts.

import { createHmac, timingSafeEqual } from "crypto";

// Nothing is written while the question is open (the 10 Oct rule still
// holds: a name that may be someone else's stays out of this person's record
// until someone says it is theirs). The read goes to the browser with the
// question, signed with a key only the server has, and comes back with the
// answer. The server checks the signature, who is answering, and the age.

/** How long a question can wait for its answer. */
export const PENDING_READ_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export type PendingRead<T> = {
  v: 1;
  /** What the question is about. */
  kind: "licence" | "cpd";
  /** The person whose card it is. */
  profileId: string;
  /** Who was asked: only they can answer. */
  askedBy: string;
  /** The file in Storage the read came from. */
  path: string;
  fileName: string;
  /** True for a file just uploaded; false for "Read from document" on one already on the record. */
  fresh: boolean;
  /** The name printed on the document. */
  nameOnDocument: string;
  /** What was read, exactly as shown in the question. */
  read: T;
  issuedAt: number;
};

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");

function signature(body: string, secret: string): string {
  // A key of its own, made from the server secret: this signature is good for
  // nothing but these questions.
  const key = createHmac("sha256", secret).update("realcomply:pending-name-read:v1").digest();
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function signPendingRead<T>(pending: PendingRead<T>, secret: string): string {
  const body = b64(JSON.stringify(pending));
  return `${body}.${signature(body, secret)}`;
}

export type VerifiedPendingRead<T> = { ok: true; pending: PendingRead<T> } | { ok: false; reason: "invalid" | "expired" | "not_yours" };

export function verifyPendingRead<T>(
  token: string,
  secret: string,
  expect: { kind: PendingRead<T>["kind"]; answeredBy: string; now: number },
): VerifiedPendingRead<T> {
  const [body, sig] = typeof token === "string" ? token.split(".") : [];
  if (!body || !sig) return { ok: false, reason: "invalid" };
  const want = Buffer.from(signature(body, secret));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" };
  let pending: PendingRead<T>;
  try {
    pending = JSON.parse(unb64(body)) as PendingRead<T>;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (pending.v !== 1 || pending.kind !== expect.kind) return { ok: false, reason: "invalid" };
  if (pending.askedBy !== expect.answeredBy) return { ok: false, reason: "not_yours" };
  if (!(expect.now - pending.issuedAt >= 0 && expect.now - pending.issuedAt <= PENDING_READ_MAX_AGE_MS)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, pending };
}

/** What the person answering sees when a question can't be answered. */
export function pendingReadProblem(reason: "invalid" | "expired" | "not_yours", what: "licence" | "certificate"): string {
  if (reason === "expired") return `That question has expired, so nothing was saved. Upload the ${what} again.`;
  if (reason === "not_yours") return "Only the person who uploaded it can answer that question.";
  return `Couldn't check that answer, so nothing was saved. Upload the ${what} again.`;
}
