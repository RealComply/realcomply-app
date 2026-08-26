import { SignupForm } from "@/components/signup/SignupForm";
import { openSignupsAllowed } from "@/lib/signups";

// A server component purely so the signup switch can be read at runtime rather
// than baked in at build time — opening signups should be a setting change, not
// a code change. Since 0033 the switch is a row in the database rather than an
// environment variable, so this is a lookup rather than an env read; the form
// itself is still a client component.
//
// This is display only. The refusal that matters is server-side — in signup(),
// because a Server Action is a real POST endpoint and a page that merely
// declines to render a form stops an ordinary visitor rather than a crafted
// request; and in bootstrap_agency_v2 itself, because a crafted request need
// not involve our code at all.
export default async function SignupPage() {
  return <SignupForm signupsOpen={await openSignupsAllowed()} />;
}
