import { Paperclip } from "lucide-react";
import { formatSignedAt } from "@/lib/pdf/sign-stamp";
import type { SgAnnexureAdoption, SignoffDocument } from "@/lib/types";

// The SG annexure in Document sign-offs (brief, 14 Oct 2026). Adopted by the
// licensee in charge from a link, so it has no signer list: the card shows
// what the adoption recorded and the signed copy. Only the licensee in charge
// (or an agent on their own plan) ever sees it (0067 and the existing
// signoff_documents rules).

export function AnnexureAdoptionCard({
  document,
  adoption,
  fileUrl,
}: {
  document: SignoffDocument;
  adoption: SgAnnexureAdoption | null;
  fileUrl: string | null;
}) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-rc-bg-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rc-muted">
            SG annexure
          </span>
          <p className="mt-1.5 text-sm font-semibold text-rc-ink">{document.title}</p>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-rc-green-deep hover:underline"
            >
              <Paperclip size={11} />
              {document.signed_file_name ?? document.file_name}
              <span className="text-rc-faint">· signed copy</span>
            </a>
          ) : (
            <p className="text-xs text-rc-muted">{document.file_name}</p>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-rc-green-soft px-2.5 py-1 text-xs font-bold text-rc-green-deep">
          Adopted
        </span>
      </div>
      {adoption && (
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-rc-border pt-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-rc-muted">Adopted by</dt>
            <dd className="font-semibold text-rc-ink">{adoption.signed_name}</dd>
          </div>
          <div>
            <dt className="text-rc-muted">Licence number given</dt>
            <dd className="font-semibold text-rc-ink">{adoption.licence_number}</dd>
          </div>
          <div>
            <dt className="text-rc-muted">Signed</dt>
            <dd className="font-semibold text-rc-ink">{formatSignedAt(adoption.signed_at)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-rc-muted">Link sent to</dt>
            <dd className="truncate font-semibold text-rc-ink">{adoption.sent_to}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
