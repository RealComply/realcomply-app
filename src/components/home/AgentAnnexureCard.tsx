import { FileSignature } from "lucide-react";
import { DOWNLOAD_LABEL, HOME_CARD_TITLE, UPLOAD_HINT, homeCardText } from "@/lib/agent-acknowledgement";
import { SignedAnnexureUpload } from "@/components/annexure/SignedAnnexureUpload";

// Home, for an agent on their own plan whose office has the lock on, until
// the signed annexure is uploaded (job 7 brief, Part 3; mockup tab 2). Then it
// goes. The download is the office's own annexure link (#42, with #45's
// "trading as" Agency line), the adoption section left blank for the licensee
// to sign by hand. RealComply never contacts the licensee.

export function AgentAnnexureCard({
  licenseeName,
  downloadHref,
  agencyId,
}: {
  licenseeName: string | null;
  downloadHref: string;
  agencyId: string;
}) {
  return (
    <section className="mt-6 rounded-card border-2 border-rc-green-deep bg-white px-4 py-4 shadow-card sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rc-green-soft text-rc-green-deep">
          <FileSignature size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-rc-ink">{HOME_CARD_TITLE}</h2>
          <p className="mt-1 text-sm leading-relaxed text-rc-muted">{homeCardText(licenseeName)}</p>
          <div className="mt-3 flex flex-wrap items-start gap-2.5">
            <a
              href={downloadHref}
              className="inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600"
            >
              {DOWNLOAD_LABEL}
            </a>
            <SignedAnnexureUpload agencyId={agencyId} variant="ghost" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-rc-faint">{UPLOAD_HINT}</p>
        </div>
      </div>
    </section>
  );
}
