import { SignupForm } from "@/components/signup/SignupForm";
import { openSignupsAllowed } from "@/lib/signups";

// A server component purely so the signup switch can be read at runtime rather
// than baked in at build time — flipping SIGNUPS_OPEN should be a setting
// change, not a code change. The form itself is still a client component.
//
// This is display only. The refusal that matters is server-side, in signup():
// a Server Action is a real POST endpoint, and a page that merely declines to
// render a form stops an ordinary visitor, not a crafted request.
export default function SignupPage() {
  return <SignupForm signupsOpen={openSignupsAllowed()} />;
}
