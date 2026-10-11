import type { Metadata } from "next";
import { Logo } from "@/components/Logo";
import { getSignoffRequest } from "@/lib/actions/signoff-links";
import { SignoffForm } from "@/components/signoff/SignoffForm";
import { ReviewAndSign } from "@/components/signoff/ReviewAndSign";
import { signoffReviewFor } from "@/lib/data/signoff-review";

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
//
// Two kinds of request since 0065 (Adam, 12 Oct 2026): the final sign-off on
// the file, and the price statement (b4) before the listing is advertised.
// The price statement page shows the words and the statement, and a box to
// approve. No file, no send-back: those belong to the final sign-off, and a
// price statement token cannot reach them (lib/data/signoff-review.ts).

export const metadata: Metadata = {
  // Neutral, because the tab cannot know which kind of request is open.
  title: "Licensee request",
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
  const [request, review] = await Promise.all([getSignoffRequest(token), signoffReviewFor(token)]);

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
          It may have already been signed or approved, been withdrawn, or expired. Contact the agent who sent it
          to you and they can issue a new one.
        </p>
      </main>
    );
  }

  if (request.item_key === "b4") {
    const requester = request.requested_by_name ?? request.agency_name;
    return (
      <main className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <Logo size={20} />

        <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
          Approve the price statement
        </h1>
        {/* The person first, as on the final sign-off page: someone the
            licensee knows, then what they are asked to do. */}
        <p className="mt-2 text-sm leading-relaxed text-rc-muted">
          {requester} has asked you to approve the price statement for {request.property_address} before it is
          advertised. Read it below, then approve it if it is right.
        </p>

        {/* The words being approved, on their own and large, so the one thing
            checked is the first thing read. break-words: a long range with no
            spaces must not push the page sideways on a phone. */}
        {request.price_statement && (
          <div className="mt-6 rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-rc-green-deep">
              Price statement to be advertised
            </p>
            <p className="mt-1.5 break-words text-xl font-bold leading-snug text-rc-ink">
              &ldquo;{request.price_statement}&rdquo;
            </p>
          </div>
        )}

        {/* The statement, exactly as the database built it when the request
            was made (0065): the listing, the ESP on the file, the words, and
            what approving means. */}
        <div className="mt-4 whitespace-pre-line break-words rounded-card border border-rc-border bg-rc-bg-alt px-5 py-5 text-sm leading-relaxed text-rc-ink">
          {request.statement}
        </div>

        <SignoffForm token={token} kind="b4" />

        <p className="mt-4 text-sm leading-relaxed text-rc-muted">
          Not right? Don&rsquo;t approve it. Reply to the email from {requester} and say what needs to change.
        </p>

        <p className="mt-8 border-t border-rc-border pt-5 text-xs leading-relaxed text-rc-muted">
          This request was sent through RealComply, the compliance system {request.agency_name} uses. RealComply
          provides diligence support to the agency. It does not certify compliance and does not provide legal
          advice. If you did not expect this request, contact the agency directly rather than approving it.
        </p>
      </main>
    );
  }

  return (
    // Wider than the "no longer valid" page: the file is read here, at close
    // to full size (Adam, 12 Oct 2026).
    <main className="mx-auto max-w-5xl px-5 py-12 sm:py-16">
      <Logo size={20} />

      <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-rc-ink sm:text-3xl">
        Licensee sign-off
      </h1>
      {/* The person, not the letterhead. A licensee in charge supervises
          people, and on a page reached from an unexpected link the first
          recognisable fact should be someone they know. The agency name is
          named in the footer, so dropping it here loses nothing — Adam,
          17 Sep 2026: "the licensee knows who works for them... otherwise it
          feels a little too formal and third party-ish."

          "Requested" and not "requires": the agency does not require anything
          of its own licensee in charge, and a page telling someone they are
          required to sign is software applying pressure to a decision that is
          theirs alone. */}
      <p className="mt-2 text-sm leading-relaxed text-rc-muted">
        {request.requested_by_name ?? request.agency_name} has requested your sign-off on the compliance file
        for {request.property_address}. Please read the statement below before signing.
      </p>

      {/* The statement, exactly as it was when the link was issued.
          whitespace-pre-line because it is authored as lines, and a serif-ish
          measure because it is read rather than skimmed. */}
      <div className="mt-6 whitespace-pre-line rounded-card border border-rc-border bg-rc-bg-alt px-5 py-5 text-sm leading-relaxed text-rc-ink">
        {request.statement}
      </div>

      {/* THE FILE, BEFORE THE SIGNATURE (Adam, 12 Oct 2026). Until then the
          licensee was shown the statement and a box to type their name, and
          could not see what they were signing. The audit pack is the file,
          exactly as the agent downloads it, marked as a draft until signed.
          The signature box stays last, so it is reached by way of the file. */}
      {review ? (
        <ReviewAndSign
          token={token}
          propertyAddress={request.property_address}
          cards={review.cards}
          agentName={review.agentName}
        />
      ) : (
        <SignoffForm token={token} />
      )}

      <p className="mt-8 border-t border-rc-border pt-5 text-xs leading-relaxed text-rc-muted">
        This request was sent through RealComply, the compliance system {request.agency_name} uses. RealComply
        provides diligence support to the agency. It does not certify compliance and does not provide legal
        advice. If you did not expect this request, contact the agency directly rather than signing.
      </p>
    </main>
  );
}
