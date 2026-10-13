// Back to the page someone opened, once they have signed in (14 Oct 2026).
//
// The agent welcome email links to pages inside the app ("Read the annexure",
// "Read your Supervision Guidelines"). Signed out, the proxy sends them to
// /login; this carries the page they asked for through the sign-in, so they
// land on it rather than on Home.
//
// Only a page inside the dashboard, written as a path on this site. Anything
// else (another site, "//evil.example", a backslash trick) falls back to Home,
// so the parameter cannot be used to send someone elsewhere.

export const HOME = "/dashboard/home";

export function nextPage(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value.startsWith("/dashboard")) return HOME;
  if (value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return HOME;
  const rest = value.slice("/dashboard".length);
  if (rest !== "" && !rest.startsWith("/") && !rest.startsWith("?")) return HOME;
  return value;
}
