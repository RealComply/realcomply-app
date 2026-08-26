import { requireProfile } from "@/lib/data/current-profile";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";

// Set a new password. Reached two ways:
//
//   1. From the link in a reset email — /auth/callback exchanges the code,
//      which creates a session, then sends the person here with ?reset=1.
//   2. From the avatar menu, by somebody already signed in.
//
// Deliberately under /dashboard rather than at the top level: both arrivals
// have a session by the time they get here, and the layout's requireProfile is
// what makes "no session" fall back to /login instead of rendering a form that
// could never save.
export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const profile = await requireProfile();
  const { reset } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">
        {reset === "1" ? "Set a new password" : "Change your password"}
      </h1>
      <p className="mt-1 text-sm text-rc-muted">
        For {profile.email}.
      </p>

      <div className="mt-6 max-w-lg">
        <ChangePasswordForm fromReset={reset === "1"} />
      </div>
    </main>
  );
}
