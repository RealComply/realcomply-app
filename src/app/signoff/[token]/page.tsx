import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { getSignoffRequest } from "@/lib/actions/signoff-links";
import { SignoffForm } from "@/components/signoff/SignoffForm";

// The public licensee sign-off page.
//
// Opened by a licensee in charge who has no RealComply account, has probably
// never heard of the product, and is being asked to put their name to
// something. So: no navigation, no marketing, no "learn more about
// RealComply", nothing to click except sign. Anything else on this page reads
// as a sales funnel wearing a compliance document's clothes, and would
// undermine the one thing it has to be, which is a credible record.
//
// The statement is rendered from the snapshot taken when the link was issued,
// never regenerated — see src/lib/signoff/statement.ts.

export const metadata: Metadata = {
  title: "Sign-off request",
  // Never index. The token is the only credential protecting this page, and a
  // crawled URL is a published one.
  robots: { index: false, follow: false },
};

// params is typed by hand rather than with the generated PageProps<"/signoff/[token]">.
// Those types are emitted by next dev/next build from the routes that exist at
// the time, so a brand-new route has none until the app is built once, and
// typechecking a fresh clone would fail on a type that has not been generated
// yet. The shape is the same: params is a Promise in this version of Next.
export default async function SignoffPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await getSignoffRequest(token);

  // One state for every failure — expired, withdrawn, already signed, or never
  // existed. Distinguishing them would let anyone with a guess find out which
  // tokens are real, and the honest instruction is the same in all four cases.
  if (!request) {
    return (
      <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-16">
        <Logo size={20} />
        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink">
          This link is no longer valid
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-rc-muted">
          It may have already been signed, been withdrawn, or expired. Contact the agent who sent it to you and
          they can issue a new one.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
      <Logo size={20} />

      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
        Licensee sign-off
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        {request.agency_name} has asked you to sign off on the compliance file for {request.property_address}.
        Read the statement below before you sign.
      </p>

      {/* The statement, exactly as it was when the link was issued.
          whitespace-pre-line because it is authored as lines, and a serif-ish
          measure because it is read rather than skimmed. */}
      <div className="mt-6 whitespace-pre-line rounded-card border border-rc-border bg-rc-bg-alt px-5 py-5 text-sm leading-relaxed text-rc-ink">
        {request.statement}
      </div>

      <SignoffForm token={token} />

      <p className="mt-8 border-t border-rc-border pt-5 text-xs leading-relaxed text-rc-muted">
        This request was sent through RealComply, the compliance system {request.agency_name} uses. RealComply
        provides diligence support to the agency. It does not certify compliance and does not provide legal
        advice. If you did not expect this request, contact the agency directly rather than signing.
      </p>
    </main>
  );
}
