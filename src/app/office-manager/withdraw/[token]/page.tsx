import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { WithdrawOfficeManagerForm } from "@/components/office-manager/WithdrawOfficeManagerForm";
import { formatAuTimestamp } from "@/lib/format-date";

// The licensee's page for withdrawing an office manager approval they gave by
// email link (0093). Opened from their confirmation email. Opening it changes
// nothing; the button does (withdraw_office_manager_by_token()).

export const metadata: Metadata = {
  title: "Withdraw office manager approval",
  robots: { index: false, follow: false },
};

type Details = { office_name: string; person_name: string; approved_by_name: string; approved_at: string };

export default async function OfficeManagerWithdrawPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = /^[0-9a-f-]{36}$/i.test(token)
    ? await supabase.rpc("office_manager_withdraw_details", { p_token: token })
    : { data: null, error: null };
  const details = !error && Array.isArray(data) ? ((data[0] ?? null) as Details | null) : null;

  if (!details) {
    return (
      <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-16">
        <Logo size={20} />
        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">This link is no longer valid</h1>
        <p className="mt-3 text-sm leading-relaxed text-rc-muted">
          The approval may already have been withdrawn. There is nothing else to do.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Logo size={20} />
        <span className="text-sm text-rc-muted">For {details.office_name}</span>
      </div>
      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
        Withdraw {details.person_name} as office manager?
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        Approved by {details.approved_by_name} on {formatAuTimestamp(details.approved_at)}. {details.person_name} loses
        the office side of the account straight away. Their own listings and records stay as they are, and anything they
        uploaded for the office stays on file. We&rsquo;ll let {details.person_name} know by email.
      </p>
      <WithdrawOfficeManagerForm token={token} personName={details.person_name} officeName={details.office_name} />
    </main>
  );
}
