import { Paperclip } from "lucide-react";
import { formatSignedAt } from "@/lib/pdf/sign-stamp";
import type { SignoffDocument } from "@/lib/types";

// Two records an agent on their own plan files in Document sign-offs (job 7
// brief, Parts 2 and 3): their "Before you start" acknowledgement, as a PDF,
// and the annexure their licensee in charge signed, as they uploaded it.
// Nobody signs either here; the card says what it is, who, when, and opens
// the file.

export function FiledRecordCard({
  document,
  fileUrl,
  label,
  status,
  details,
}: {
  document: SignoffDocument;
  fileUrl: string | null;
  /** The small tag above the title. */
  label: string;
  /** The pill on the right. */
  status: string;
  details: Array<{ term: string; value: string }>;
}) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-rc-bg-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rc-muted">
            {label}
          </span>
          <p className="mt-1.5 text-sm font-semibold text-rc-ink">{document.title}</p>
          {fileUrl ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-0.5 inline-flex max-w-full items-start gap-1 text-xs text-rc-green-deep hover:underline"
            >
              <Paperclip size={11} className="mt-0.5 shrink-0" />
              <span className="break-all">{document.signed_file_name ?? document.file_name}</span>
            </a>
          ) : (
            <p className="break-all text-xs text-rc-muted">{document.file_name}</p>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap rounded-full bg-rc-green-soft px-2.5 py-1 text-xs font-bold text-rc-green-deep">
          {status}
        </span>
      </div>
      {details.length > 0 && (
        <dl className="mt-3 grid gap-x-4 gap-y-1.5 border-t border-rc-border pt-3 text-xs sm:grid-cols-2">
          {details.map((d) => (
            <div key={d.term} className="min-w-0">
              <dt className="text-rc-muted">{d.term}</dt>
              <dd className="break-words font-semibold text-rc-ink">{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** "14 October 2026, 9:42 am" (Sydney), as the other sign-off cards show it. */
export const when = (iso: string | null | undefined) => (iso ? formatSignedAt(iso) : "");
