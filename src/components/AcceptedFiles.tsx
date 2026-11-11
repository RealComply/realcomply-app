"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, FileText } from "lucide-react";
import {
  ACCEPTED_FILES,
  ACCEPTED_FILES_WITH_WORD,
  UPLOAD_A_PDF,
  savedButCantRead,
  unreadableKind,
  wordFileNotice,
} from "@/lib/storage/accepted-files";

// The two pieces every upload RealComply reads shares (Adam, 2 to 3 Nov 2026;
// mockup approved). The words and the rule are in lib/storage/accepted-files.ts.

/**
 * "Accepted files: Clear photo or PDF.", small and grey, right under the
 * upload. Styled as it was first built for the ESP notice upload.
 */
export function AcceptedFilesLine({ className = "", word = false }: { className?: string; word?: boolean }) {
  return <p className={`text-[11px] text-rc-muted ${className}`.trim()}>{word ? ACCEPTED_FILES_WITH_WORD : ACCEPTED_FILES}</p>;
}

/**
 * What a reading upload says about a stored Word, Excel or saved email file:
 * it is saved, it can't be read, and a PDF can be. Nothing at all for any
 * other file, so a spot can render it whatever is attached.
 *
 * In place of the reader's own failure, never beside it: the person sees one
 * message, not two, and never a raw file type.
 *
 * "Upload a PDF" goes straight to choosing the replacement at the same spot.
 * Left off (no onUploadPdf) only where the person can't replace the file
 * there.
 */
export function CantReadNotice({
  fileName,
  onUploadPdf,
  disabled = false,
  className = "",
  listingCard = false,
}: {
  fileName: string | null | undefined;
  onUploadPdf?: () => void;
  disabled?: boolean;
  className?: string;
  /** On a listing card, where a Word file (.docx) is read (Adam, 11 Nov 2026). */
  listingCard?: boolean;
}) {
  const kind = unreadableKind(fileName, { listingCard });
  if (!kind) return null;
  return (
    <div
      role="status"
      className={`flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-2 text-xs text-rc-amber-deep ${className}`.trim()}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        <p>{savedButCantRead(kind)}</p>
        {onUploadPdf && (
          <button
            type="button"
            onClick={onUploadPdf}
            disabled={disabled}
            className="rounded-md border border-rc-border bg-white px-2.5 py-1 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
          >
            {UPLOAD_A_PDF}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A Word file on a listing card (Adam, 11 Nov 2026): read (or kept), and in
 * the audit pack only as a plain copy (a .docx) or not at all (a .doc), so the
 * card says so, with "Upload a PDF" to replace it.
 * The PDF replaces the file as Replace does, and is read in its turn; what
 * was read from the Word file stays on the card, since a read adds to what is
 * there. Nothing for any other file.
 */
export function WordFileNotice({
  fileName,
  read,
  onUploadPdf,
  disabled = false,
  className = "",
}: {
  fileName: string | null | undefined;
  /** The card reads its file, or checks it as the identity card does. */
  read: boolean;
  onUploadPdf?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const text = wordFileNotice(fileName, { read });
  if (!text) return null;
  return (
    <div
      role="status"
      className={`flex items-start gap-1.5 rounded-lg border border-rc-border bg-rc-bg-alt px-2.5 py-2 text-xs text-rc-ink ${className}`.trim()}
    >
      <FileText size={13} className="mt-0.5 shrink-0 text-rc-muted" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        <p>{text}</p>
        {onUploadPdf && (
          <button
            type="button"
            onClick={onUploadPdf}
            disabled={disabled}
            className="rounded-md border border-rc-border bg-white px-2.5 py-1 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
          >
            {UPLOAD_A_PDF}
          </button>
        )}
      </div>
    </div>
  );
}

// ── "Upload a PDF" from another spot ───────────────────────────────────────
//
// One notice sits away from the upload its file belongs to: the ESP reasoning
// card (a4c) speaks for the comparable-sales report on the ESP card (a4). Its
// button asks that upload to open its own picker, by name. The ask is sent and
// answered in the same click, so the browser still lets the picker open.

const ASK = "realcomply:upload-pdf";

/** Asks the upload named `spot` (a card's item key) to open its picker. */
export function askForPdfAt(spot: string) {
  window.dispatchEvent(new CustomEvent<string>(ASK, { detail: spot }));
}

/** Answers askForPdfAt(spot) by calling `open`. A null spot answers nothing. */
export function useUploadPdfAsk(spot: string | null, open: () => void) {
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(() => {
    if (!spot) return;
    const answer = (e: Event) => {
      if ((e as CustomEvent<string>).detail === spot) latest.current();
    };
    window.addEventListener(ASK, answer);
    return () => window.removeEventListener(ASK, answer);
  }, [spot]);
}
