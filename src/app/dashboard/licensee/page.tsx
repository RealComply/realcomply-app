import { redirect } from "next/navigation";

// This page merged into /dashboard/portfolio ("Office overview") — Adam
// noticed the two were "basically showing the same thing" and asked to
// condense them. Kept as a redirect (rather than deleting the route
// outright) so any bookmark or stale link to /dashboard/licensee still
// lands somewhere useful instead of a 404.
export default function LicenseeDigestRedirect() {
  redirect("/dashboard/portfolio");
}
