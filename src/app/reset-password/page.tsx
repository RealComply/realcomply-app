import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";

export const metadata: Metadata = {
  title: "Set a new password · RealComply",
};

// Where a password reset link lands (10 Oct 2026).
//
// It used to land on /dashboard/password, under the dashboard layout. That
// layout shows another page in place of every dashboard page while a trial
// is still to start or after a subscription has ended, and sends anyone with
// new terms to accept to /accept-terms, which then goes to Home. In each case
// the link signed the person in and the form to set a password never showed.
//
// Deliberately outside /dashboard, the same as /accept-terms, so none of
// those checks stands between a reset link and the form. Setting a password
// is not using the app; "Go to Home" afterwards meets the checks as usual.
// Changing a password from the avatar menu stays at /dashboard/password.
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="relative isolate flex flex-1 items-center justify-center overflow-hidden bg-rc-bg-alt px-4 py-16">
      <div className="rc-mesh-bg" />
      <div className="w-full max-w-md">
        <Logo size={22} />
        <h1 className="mt-8 text-lg font-bold tracking-tight text-rc-ink">Set a new password</h1>
        <p className="mt-1 text-sm text-rc-muted">For {user.email}.</p>
        <div className="mt-6">
          <ChangePasswordForm fromReset />
        </div>
      </div>
    </main>
  );
}
