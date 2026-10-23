// Plain words for a password Supabase refuses (Adam, 23 Oct 2026).
//
// Ahead of switching on leaked password protection in Supabase Auth, which
// refuses any password found in a known data breach, at sign-up and whenever a
// password is set or changed. Until now the refusal reached the form as
// Supabase's own technical message.
//
// Text only. Supabase still decides what is allowed; this only says why it
// said no. The length and the character types come from Supabase's own message,
// so they follow the setting in the dashboard rather than a copy kept here that
// could drift from it.
//
// Never logs, stores or returns the password. It only ever sees the error.

// Reworded 23 Oct 2026 (Adam). Was "This password has appeared in a data
// breach elsewhere, so it isn't safe to use. Please choose a different one."
export const LEAKED_PASSWORD_MESSAGE =
  "This password appears on public lists of passwords leaked from other websites over the years. Please choose a different one.";
export const GENERIC_PASSWORD_MESSAGE = "That password can't be used. Please try a different one.";

type MaybeAuthError = {
  code?: string;
  message?: string;
  reasons?: unknown;
} | null | undefined;

// Error codes that mean "this password, specifically, was refused". Anything
// else (rate limits, an expired session, a network failure) is not about the
// password and keeps its own handling.
const PASSWORD_CODES = new Set(["weak_password", "same_password"]);

export function isPasswordRefusal(error: MaybeAuthError): boolean {
  return !!error?.code && PASSWORD_CODES.has(error.code);
}

// "a lowercase letter, a capital letter and a number", from Supabase's
// "Password should contain at least one character of each: abc…z, ABC…Z, 0…9."
// Matched by the sets themselves rather than by splitting on commas, because
// the symbol set contains commas and full stops of its own.
function requiredCharacters(message: string): string | null {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const parts: string[] = [];
  if (message.includes(lower + upper)) {
    // "Letters and digits": one set holding both cases, so either will do.
    parts.push("a letter");
  } else {
    if (message.includes(lower)) parts.push("a lowercase letter");
    if (message.includes(upper)) parts.push("a capital letter");
  }
  if (message.includes("0123456789")) parts.push("a number");
  if (message.includes("!@#$%^&*()")) parts.push("a symbol");
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function passwordRefusalMessage(error: MaybeAuthError): string {
  if (!error || error.code !== "weak_password") return GENERIC_PASSWORD_MESSAGE;

  const reasons = Array.isArray(error.reasons) ? error.reasons.map(String) : [];
  const message = error.message ?? "";
  const lines: string[] = [];

  if (reasons.includes("length")) {
    const n = message.match(/at least (\d+) characters/)?.[1];
    if (n) lines.push(`Your password needs at least ${n} characters.`);
  }
  if (reasons.includes("characters")) {
    const what = requiredCharacters(message);
    if (what) lines.push(`Please include ${what}.`);
  }
  if (reasons.includes("pwned")) {
    lines.push(LEAKED_PASSWORD_MESSAGE);
  }

  return lines.length > 0 ? lines.join(" ") : GENERIC_PASSWORD_MESSAGE;
}
