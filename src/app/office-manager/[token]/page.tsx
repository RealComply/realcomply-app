import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { ApproveOfficeManagerForm } from "@/components/office-manager/ApproveOfficeManagerForm";
import { LICENSEE_KEEPS, OFFICE_MANAGER_CAN } from "@/lib/email/office-manager";

// The licensee's page for approving an office manager (0093; mockup approved
// by Adam, 26 Oct 2026). Opened from an email by a licensee in charge with no
// RealComply login, so, like the sign-off page: no navigation, nothing to
// click except approve. The token is the only credential; the page reads
// through office_manager_request_details() and writes through
// approve_office_manager(), nothing else.

export const metadata: Metadata = {
  title: "Office manager approval",
  // Never index. The token is the credential, and a crawled URL is a published one.
  robots: { index: false, follow: false },
};

type Details = {
  office_name: string;
  person_name: string;
  person_email: string;
  licensee_name: string | null;
  wording: string;
  expires_at: string;
};

// params is typed by hand, as on the sign-off page: generated route types do
// not exist for a new route until the app is built once.
export default async function OfficeManagerApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data, error } = /^[0-9a-f-]{36}$/i.test(token)
    ? await supabase.rpc("office_manager_request_details", { p_token: token })
    : { data: null, error: null };
  const details = !error && Array.isArray(data) ? ((data[0] ?? null) as Details | null) : null;

  // One state for every failure: used, taken back, out of date, or never
  // existed. Telling them apart would show which tokens are real.
  if (!details) {
    return (
      <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-16">
        <Logo size={20} />
        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">This link is no longer valid</h1>
        <p className="mt-3 text-sm leading-relaxed text-rc-muted">
          It may have already been approved, been taken back, or expired. Contact the person who asked and they can
          send a new one.
        </p>
      </main>
    );
  }

  const first = details.person_name.split(/\s+/)[0] || details.person_name;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Logo size={20} />
        <span className="text-sm text-rc-muted">For {details.office_name}</span>
      </div>

      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
        Approve {details.person_name} as office manager
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        {details.person_name} ({details.person_email}) has asked you, as licensee in charge of {details.office_name}, to
        approve them as office manager on RealComply.
      </p>

      <p className="mt-6 break-words rounded-card border border-rc-green-deep/25 bg-rc-green-soft px-4 py-4 text-base font-semibold leading-relaxed text-rc-ink">
        {details.wording}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-card border border-rc-border bg-white px-4 py-4">
          <h2 className="text-sm font-bold text-rc-ink">An office manager can</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-rc-muted">
            {OFFICE_MANAGER_CAN.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-card border border-rc-border bg-white px-4 py-4">
          <h2 className="text-sm font-bold text-rc-ink">These stay with you</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-rc-muted">
            {LICENSEE_KEEPS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <ApproveOfficeManagerForm
        token={token}
        personName={details.person_name}
        officeName={details.office_name}
        wording={details.wording}
      />
      <p className="mt-8 text-xs leading-relaxed text-rc-faint">
        If you don&rsquo;t want {first} to be office manager, don&rsquo;t approve. This page changes nothing until you
        press the button.
      </p>
    </main>
  );
}
