import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/lib/actions/auth";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "Access removed · RealComply",
};

// Where requireProfile sends someone the licensee in charge has removed from
// the office (10 Oct 2026). Until now they landed on the signup page, told
// RealComply is invite-only and to sign in, with nothing saying what had
// happened.
//
// Outside /dashboard, and never calls requireProfile, so it cannot send
// itself here again. It says nothing about the office (not its name, not who
// removed them): an archived person no longer sees any of it. Someone who is
// not archived, or a database without my_profile_is_archived() yet (0060),
// goes back to the dashboard, which is where they would have been.
export default async function RemovedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: archived, error } = await supabase.rpc("my_profile_is_archived");
  if (error || archived !== true) redirect("/dashboard/home");

  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-rc-bg-alt px-4 py-16">
      <div className="w-full max-w-md rounded-card border border-rc-border bg-white p-8 text-center shadow-card">
        <Logo />
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-rc-ink">Your access has been removed</h1>
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          The licensee in charge has removed you from the office in RealComply, so you can no longer open its
          records. If you think that&rsquo;s a mistake, ask your licensee in charge. They can bring you back.
        </p>
        <form action={logout} className="mt-6">
          <button
            type="submit"
            className="inline-flex rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
