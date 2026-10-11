// Where links in emails point.
//
// The live site, except on a Vercel preview, where it is that branch's own
// stable address. Previews share the production database, so an email sent
// while testing a preview must bring the reader back to the preview, where
// the code being tested runs (found testing the early access invites,
// 11 Oct 2026, and the licensee review, 12 Oct 2026). On the live site this
// is always NEXT_PUBLIC_SITE_URL.
export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) {
    return `https://${env.VERCEL_BRANCH_URL}`;
  }
  return env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";
}
