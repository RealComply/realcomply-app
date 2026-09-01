import { createHmac, timingSafeEqual } from "crypto";

// The acknowledgement a registrant receives after joining the early-access
// list, and the unsubscribe machinery that has to travel with it.
//
// WHY THIS EXISTS. Until now the early-access path emailed Adam and sent the
// registrant nothing. Adam, 3 Sep 2026: "All i want right now is an
// acknowledgment email in reply to the early access request so we look
// professional." The copy below is his, approved verbatim — do not rewrite it
// to sound more like marketing.
//
// "Hi there" rather than a first name is a decision, not a gap. The form asks
// for an email address and nothing else, and Adam chose to keep it that way
// rather than add a field that costs conversions on a paid ad click.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

export const EARLY_ACCESS_SUBJECT = "Thank you for registering for early access to RealComply";

/**
 * Unsubscribe token: an HMAC of the address under a server-only secret.
 *
 * Deliberately derived rather than stored. The insert path uses the ANON
 * client against an insert-only table (0013) — it cannot read a row back, and
 * adding a select policy to fetch a stored token would hand the anon key the
 * ability to read the whole list. Deriving the token needs no read at all.
 *
 * Returns null when the secret is unset, and the caller falls back to a
 * reply-to-unsubscribe instruction. A missing env var must not mean an email
 * goes out with no unsubscribe facility at all.
 */
export function unsubscribeToken(email: string): string | null {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

/** Constant-time check. A plain === leaks position through timing. */
export function unsubscribeTokenValid(email: string, token: string): boolean {
  const expected = unsubscribeToken(email);
  if (!expected) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function unsubscribeUrl(email: string): string | null {
  const token = unsubscribeToken(email);
  if (!token) return null;
  const u = new URL("/unsubscribe", SITE_URL);
  u.searchParams.set("e", email);
  u.searchParams.set("t", token);
  return u.toString();
}

/**
 * Who to greet.
 *
 * Adam's approved copy opens "Hi [first name]," and always did. It shipped as
 * "Hi there," on 3 Sep only because the form collected an address and nothing
 * else; the field was added hours later and the copy goes back to what he
 * actually wrote.
 *
 * "Hi there," survives as the fallback for the rows captured before the field
 * existed, and for anything that reaches here with a blank. A greeting reading
 * "Hi ," is worse than not using a name at all.
 *
 * Only the first character is touched. Full title-casing would rewrite names
 * it has no business rewriting, and someone who types "sarah" is better served
 * by "Sarah" than by a system that decides it knows how "de Silva" is spelt.
 */
function greetingName(firstName?: string | null): string {
  const name = (firstName ?? "").trim();
  if (!name) return "there";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * The message body.
 *
 * Adam's copy is the first block and is reproduced exactly. Everything after
 * the rule is appended by the system: the diligence-support line that the
 * whole liability posture depends on being said consistently, and the
 * unsubscribe facility that the Spam Act 2003 requires on a commercial
 * electronic message.
 */
export function earlyAccessAcknowledgementText(email: string, firstName?: string | null): string {
  const link = unsubscribeUrl(email);

  const optOut = link
    ? `Unsubscribe: ${link}`
    : "To stop receiving these, reply to this email with UNSUBSCRIBE and we will remove you.";

  return [
    `Hi ${greetingName(firstName)},`,
    "",
    "Thank you for registering for early access to RealComply. You're on the list!",
    "",
    "We will be onboarding new clients over the next two weeks and will be in touch to get you set up.",
    "",
    "We look forward to assisting you with your real estate compliance.",
    "",
    "The RealComply Team",
    "",
    "—",
    "RealComply provides diligence support. It is not legal advice, and the licensee remains responsible for decisions and sign-off.",
    "",
    "You are receiving this because you registered for early access at realcomply.com.au.",
    optOut,
  ].join("\n");
}
