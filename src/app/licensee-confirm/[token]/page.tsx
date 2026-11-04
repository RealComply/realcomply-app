import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { ConfirmLicenseeForm } from "@/components/licensee-email/ConfirmLicenseeForm";
import { formatAuTimestamp } from "@/lib/format-date";

// The page the confirm email opens (0112; Master, 4 Nov 2026). Opened by
// whoever has the licensee email, with no RealComply login, so no navigation
// and one button. It says only "Confirm you're the licensee in charge at
// [office]": nothing from the office's records. The token is the only
// credential; the page reads through licensee_confirmation_details() and
// writes through confirm_licensee_email(), nothing else.

export const metadata: Metadata = {
  title: "Confirm you're the licensee in charge",
  // Never index. The token is the credential, and a crawled URL is a published one.
  robots: { index: false, follow: false },
};

type Details = { office_name: string; email: string; confirmed_at: string | null; is_current: boolean };

export default async function LicenseeConfirmPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = /^[0-9a-f-]{36}$/i.test(token)
    ? await supabase.rpc("licensee_confirmation_details", { p_token: token })
    : { data: null, error: null };
  const details = !error && Array.isArray(data) ? ((data[0] ?? null) as Details | null) : null;

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-16">
      <Logo size={20} />
      {!details || !details.is_current ? (
        <>
          <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">This link is no longer valid</h1>
          <p className="mt-3 text-sm leading-relaxed text-rc-muted">
            The office may have changed its licensee email since it was sent. If you&rsquo;re the licensee in charge,
            ask the office to send it again.
          </p>
        </>
      ) : details.confirmed_at ? (
        <>
          <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">Already confirmed</h1>
          <p className="mt-3 text-sm leading-relaxed text-rc-muted">
            {details.email} was confirmed for {details.office_name} on {formatAuTimestamp(details.confirmed_at)}.
            There&rsquo;s nothing else to do.
          </p>
        </>
      ) : (
        <>
          <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">
            Confirm you&rsquo;re the licensee in charge at {details.office_name}
          </h1>
          <ConfirmLicenseeForm token={token} officeName={details.office_name} />
          <p className="mt-8 text-xs leading-relaxed text-rc-faint">
            If you&rsquo;re not the licensee in charge at {details.office_name}, close this page. Nothing changes until
            you press the button.
          </p>
        </>
      )}
    </main>
  );
}
