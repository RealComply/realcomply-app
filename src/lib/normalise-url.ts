// Accept a website address the way a person types one.
//
// Adam, 18 Aug 2026: he typed "www.cassproperty.com.au" into the agency
// website field, was told "please enter a URL", and had to go to his own
// site, copy the address bar and paste it back. That is the app making a
// person do a computer's job.
//
// Two things were causing it, and both needed fixing — changing only one
// leaves the other still rejecting him:
//   1. type="url" on the input, so the BROWSER blocked submission before
//      anything of ours ran.
//   2. a server-side check that the value started with http:// or https://.
//
// Nobody says "https://" out loud. They say cassproperty.com.au. The scheme
// is an implementation detail of the web, and asking for it is asking the
// user to know one.
//
// What this deliberately does NOT do is try to be clever about whether the
// site exists or resolves. A typo'd domain surfaces the first time the weekly
// price check tries to find a listing, which is a better place to discover it
// than a form that guesses.

export type NormalisedUrl =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Turns what someone typed into a canonical https:// URL.
 *
 * Accepts: cassproperty.com.au · www.cassproperty.com.au ·
 * https://www.cassproperty.com.au/ · HTTP://Cassproperty.com.au ·
 * cassproperty.com.au/listings — with or without surrounding whitespace.
 *
 * An explicit http:// is preserved rather than upgraded: a site that is
 * genuinely http-only would otherwise become unreachable, and silently
 * rewriting what someone typed is its own kind of rude.
 */
export function normaliseWebsiteUrl(raw: string | null | undefined): NormalisedUrl {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: true, url: "" };

  // A space almost always means a sentence or a typo rather than an address,
  // and it is the one case where guessing produces something confidently wrong.
  if (/\s/.test(trimmed)) {
    return { ok: false, error: "That doesn't look like a website address — remove any spaces." };
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: "That doesn't look like a website address. Something like cassproperty.com.au is fine." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Use a web address — something like cassproperty.com.au." };
  }

  // A hostname with no dot is either localhost or a typo. Neither is an
  // agency website, and accepting it would send the weekly scan nowhere.
  if (!parsed.hostname.includes(".")) {
    return { ok: false, error: "That doesn't look like a website address. Something like cassproperty.com.au is fine." };
  }

  // Trailing slash on the root only — "example.com/" and "example.com" are the
  // same place, and storing one form keeps comparisons simple later.
  const url = parsed.toString().replace(/\/$/, "");
  return { ok: true, url };
}
