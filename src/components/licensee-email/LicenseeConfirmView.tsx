import { Logo } from "@/components/Logo";
import { ConfirmLicenseeForm } from "@/components/licensee-email/ConfirmLicenseeForm";
import { formatAuTimestamp } from "@/lib/format-date";

// What the confirm page shows (0112; Master, 4 Nov 2026): no navigation, one
// button, and nothing from the office's records but its name. Kept apart
// from the page so the page only reads the token.

export type LicenseeConfirmDetails = {
  office_name: string;
  email: string;
  confirmed_at: string | null;
  is_current: boolean;
};

export function LicenseeConfirmView({ token, details }: { token: string; details: LicenseeConfirmDetails | null }) {
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
