import Link from "next/link";
import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { AnnexureText } from "@/components/annexure/AnnexureText";
import { AdoptAnnexureForm } from "@/components/annexure/AdoptAnnexureForm";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET, isInFolder } from "@/lib/storage/evidence";
import { SG_ANNEXURE_VERSION, annexureDate } from "@/lib/legal/sg-annexure";
import { linkDetails, type AnnexureLinkDetails } from "@/lib/sg-annexure/adopt";

// The page the licensee in charge adopts the SG annexure on (brief, 14 Oct
// 2026). Signed out, like the licensee sign-off page: it is opened from an
// email by someone who may never have logged in to RealComply. The token in
// the address is the credential; everything goes through 0067's functions.
//
// The office's logo at the top where one is saved, otherwise the RealComply
// wordmark. The annexure in a scrolling panel, its PDF, then the form.
//
// "preview" is the page the staff test email links to: a made-up office, and
// a button that cannot sign.

export const metadata: Metadata = {
  title: "Adopt the annexure",
  // Never index. The token is the only credential protecting this page.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PREVIEW: AnnexureLinkDetails = {
  agencyId: "",
  agencyName: "Your agency",
  licensedEntityName: null,
  licenceNumber: null,
  logoPath: null,
  sentTo: "",
  state: "open",
  adoptedAt: null,
};

/**
 * The logo's address for the page, or null. A logo that won't load never stops
 * the page. Signed with full rights, so only from the office's own folder
 * (20 Oct 2026; 0085 refuses any other path).
 */
async function logoUrl(path: string | null, agencyId: string): Promise<string | null> {
  if (!path || !isInFolder(path, `${agencyId}/`)) return null;
  try {
    const { data } = await createServiceClient().storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-16">
      <Logo size={20} />
      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">{title}</h1>
      <div className="mt-3 text-sm leading-relaxed text-rc-muted">{children}</div>
      <div className="mt-6">
        <BackToApp />
      </div>
    </main>
  );
}

// A way back into RealComply from every state of the page (Adam, 14 Oct
// 2026: after signing "there was no way to get out of the page back into
// RealComply"). Home when signed in; the sign-in page, then Home, when the
// page was opened from the email.
function BackToApp() {
  return (
    <Link
      href="/dashboard/home"
      className="shrink-0 text-sm font-semibold text-rc-green-deep transition hover:underline"
    >
      Back to RealComply
    </Link>
  );
}

export default async function AnnexurePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const preview = token === "preview";
  const details = preview ? PREVIEW : await linkDetails(await createClient(), token, SG_ANNEXURE_VERSION);

  // A token that never existed, was used, or has expired all read the same:
  // telling them apart would let anyone with a guess find out which are real.
  if (!details || details.state === "used" || details.state === "expired") {
    return (
      <Message title="This link is no longer valid">
        <p>It may have been used already, or it has expired.</p>
        <p className="mt-2">
          If you use RealComply, press <strong>Review and sign</strong> on your Home page for a fresh link.
          Otherwise, reply to the email this link came in and we&rsquo;ll send you a new one.
        </p>
      </Message>
    );
  }
  if (details.state === "ended") {
    return (
      <Message title="This agency's subscription has ended">
        <p>The annexure can&rsquo;t be adopted for {details.agencyName} any more.</p>
      </Message>
    );
  }
  if (details.state === "adopted") {
    return (
      <Message title="Already adopted">
        <p>
          The annexure was adopted for {details.agencyName}
          {details.adoptedAt ? ` on ${annexureDate(details.adoptedAt)}` : ""}. The signed copy was emailed at the
          time, and the licensee in charge can find it in RealComply under Registers, Document sign-offs.
        </p>
      </Message>
    );
  }

  const logo = await logoUrl(details.logoPath, details.agencyId);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-5 sm:py-14">
      <div className="flex items-start justify-between gap-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={`${details.agencyName} logo`} className="max-h-12 max-w-[200px] object-contain" />
        ) : (
          <Logo size={20} />
        )}
        <BackToApp />
      </div>

      {preview && (
        <p className="mt-6 rounded-lg border border-rc-amber/30 bg-rc-amber/10 px-3.5 py-2.5 text-sm text-rc-amber-deep">
          Preview from a test email. This is what a licensee sees. Nothing can be signed here.
        </p>
      )}

      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
        Adopt the annexure to your Supervision Guidelines
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        It records how your agency uses RealComply within your existing supervision system. You stay in charge of
        your agency&rsquo;s compliance. Read it below, then sign at the bottom.
      </p>

      <div
        tabIndex={0}
        aria-label="The annexure"
        className="mt-6 max-h-[60vh] overflow-y-auto rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-6"
      >
        <AnnexureText />
      </div>
      <a
        href={`/annexure/${encodeURIComponent(token)}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block text-sm font-semibold text-rc-green-deep hover:underline"
      >
        Download the full annexure (PDF)
      </a>

      <div className="mt-8">
        <AdoptAnnexureForm
          token={token}
          agencyName={details.agencyName}
          licensedEntityName={details.licensedEntityName}
          licenceNumber={details.licenceNumber}
          date={annexureDate()}
          preview={preview}
        />
      </div>
    </main>
  );
}
