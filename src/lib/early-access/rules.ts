// The rules behind the early access list on the staff page, kept free of
// database and email code so they can be tested on their own.

/** Adam's own test addresses. Never shown on the list (brief, 10 Oct 2026). */
const HIDDEN_DOMAINS = ["realcomply.com.au", "cassproperty.com.au"];

export function hiddenFromList(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return HIDDEN_DOMAINS.includes(domain);
}

export type EarlyAccessStatus = "not_invited" | "invited" | "signed_up" | "unsubscribed";

export type StatusInput = {
  invitedAt: string | null;
  unsubscribedAt: string | null;
  declinedAt: string | null;
  /** When their invitation link was used to create an agency, if it has been. */
  signedUpAt: string | null;
};

/**
 * Which tab a row belongs in.
 *
 * Signed up wins over everything: that person is a customer now, and what the
 * list is for is knowing who to invite next. Then unsubscribed or declined,
 * because those can never be emailed. Then invited.
 */
export function earlyAccessStatus(row: StatusInput): EarlyAccessStatus {
  if (row.signedUpAt) return "signed_up";
  if (row.unsubscribedAt || row.declinedAt) return "unsubscribed";
  if (row.invitedAt) return "invited";
  return "not_invited";
}

/**
 * Whether an invitation may go to this address at all.
 *
 * Adam, 10 Oct 2026: no real invitations go out until agency access and the
 * code review fixes are live and the new terms are published, and tests use
 * only made-up registrants at addresses he owns. Previews also share the live
 * database, so the real list is on screen there with live buttons.
 *
 * So the default is locked: only Adam's own plus-addresses can be sent to.
 * Setting EARLY_ACCESS_INVITES=live in Vercel (production only) is the
 * deliberate act that opens it to the real list.
 */
const TEST_ADDRESS = /^getadamc3\+[^@\s]+@gmail\.com$/i;

export function isTestAddress(email: string): boolean {
  return TEST_ADDRESS.test(email.trim());
}

export function invitesLive(env: Record<string, string | undefined> = process.env): boolean {
  return env.EARLY_ACCESS_INVITES === "live" && env.VERCEL_ENV === "production";
}

export function maySendTo(email: string, env: Record<string, string | undefined> = process.env): boolean {
  return invitesLive(env) || isTestAddress(email);
}

/** The welcome email's switch (brief Part C): off unless set to "on". */
export function welcomeSwitchedOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.EARLY_ACCESS_WELCOME_EMAIL === "on";
}
