"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, X } from "lucide-react";
import { TrustMonthCard } from "@/components/registers/TrustMonthCard";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { formatAuDate } from "@/lib/format-date";
import { MONTH_STATUS_LABELS, type ReconciliationMonth } from "@/lib/trust-account";

// One month, opened on the page rather than in another tab.
//
// Adam, 8 Sep 2026: "I want to be able to click on these cards, even past
// ones. Once uploaded and signed, I want to click the card with the month and
// have the signed PDF open with a window on screen (so we don't have to leave
// the page)."
//
// TWO PROBLEMS, and the first is the one that actually bit him. The twelve
// month tiles were plain divs. The card underneath — with the file, the
// signature and now Replace — only ever rendered for outstanding months plus
// the single most recent signed one. So a signed month from earlier in the
// audit year had NO route to it at all: not the tile, which did nothing, and
// not the card, which was not drawn. The document was on file and unreachable,
// which for a record cl 27(5)(b) requires and s104 keeps for three years is
// close to not having it.
//
// The second is the smaller one he names: a new tab loses the register. Twelve
// months on one screen is the view that answers "what is missing", and sending
// someone away from it to look at one PDF costs them the thing they came for.
//
// WHY THE WHOLE CARD IS IN HERE, not just a preview. The reason to open a month
// is rarely only to look — it is to check it and then do something: sign it,
// or replace the wrong file. Putting the preview in a viewer and the controls
// back on the page would mean opening the document, closing it, then hunting
// for the card. So the dialog carries the real TrustMonthCard, in embedded
// form, and every action works from here.

export function TrustMonthDialog({
  month,
  agencyId,
  trustAccountId,
  accountName,
  canUpload,
  canSign,
  signerName,
  onClose,
}: {
  month: ReconciliationMonth;
  agencyId: string;
  trustAccountId: string;
  accountName: string;
  canUpload: boolean;
  canSign: boolean;
  signerName: string;
  onClose: () => void;
}) {
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Escape closes it, and the page behind stops scrolling while it is open —
  // a modal you can scroll the page under reads as broken.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    if (!month.filePath) return;
    let cancelled = false;
    const bucket = createBrowserClient().storage.from(EVIDENCE_BUCKET);

    bucket.createSignedUrl(month.filePath, 3600).then(({ data }) => {
      if (!cancelled) setViewUrl(data?.signedUrl ?? null);
    });
    bucket
      .createSignedUrl(month.filePath, 3600, { download: month.fileName ?? true })
      .then(({ data }) => {
        if (!cancelled) setDownloadUrl(data?.signedUrl ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [month.filePath, month.fileName]);

  // Only ever rendered once a tile has been clicked, so on the server there
  // is nothing to portal into and nothing to draw.
  if (typeof document === "undefined") return null;

  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(month.fileName ?? "");
  const isPdf = /\.pdf$/i.test(month.fileName ?? "");

  // Portalled to the body. Nested inside the register it would inherit the
  // card's stacking context and end up behind the sticky header.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-rc-ink/50 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${month.label} reconciliation`}
      // Clicking the backdrop closes; clicking inside must not. Checking the
      // target is the element itself rather than stopping propagation inside,
      // which would also swallow clicks the form controls need.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-rc-border bg-white shadow-card-lg">
        <div className="flex items-start justify-between gap-3 border-b border-rc-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-bold tracking-tight text-rc-ink">
              {month.label} — {accountName}
            </p>
            <p className="mt-0.5 text-xs text-rc-muted">
              {month.status === "signed" && month.signedAt
                ? `Signed ${formatAuDate(month.signedAt.slice(0, 10))}${
                    month.signedName ? ` by ${month.signedName}` : ""
                  }`
                : `${MONTH_STATUS_LABELS[month.status]}${
                    month.dueOn ? ` · due ${formatAuDate(month.dueOn)}` : ""
                  }`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {month.filePath && (
            <div className="border-b border-rc-border bg-rc-bg-alt">
              {/* The document itself. A PDF renders in the browser's own
                  viewer, which already has page controls, zoom and search —
                  building a second one would be worse and never finished. */}
              <div className="h-[52vh] w-full bg-white">
                {!viewUrl ? (
                  <div className="flex h-full items-center justify-center text-xs text-rc-faint">
                    Opening the report…
                  </div>
                ) : isPdf ? (
                  <iframe
                    src={viewUrl}
                    title={`${month.label} reconciliation report`}
                    className="h-full w-full"
                  />
                ) : isImage ? (
                  <div className="flex h-full items-center justify-center overflow-auto p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={viewUrl}
                      alt={`${month.label} reconciliation report`}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  // A .xlsx or .csv export cannot be shown in a frame. Said
                  // plainly, with the two things that do work, rather than
                  // rendered as an empty box the agent reads as a failure.
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <p className="text-sm font-semibold text-rc-ink">{month.fileName}</p>
                    <p className="text-xs text-rc-muted">
                      This file type can&rsquo;t be previewed here. Download it, or open it in a new tab.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                <a
                  href={downloadUrl ?? undefined}
                  aria-disabled={!downloadUrl}
                  className={`inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3.5 py-1.5 text-xs font-semibold text-white transition ${
                    downloadUrl ? "hover:bg-rc-green-deep-600" : "pointer-events-none opacity-50"
                  }`}
                >
                  <Download size={12} aria-hidden="true" />
                  Download
                </a>
                <a
                  href={viewUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!viewUrl}
                  className={`inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3.5 py-1.5 text-xs font-semibold transition ${
                    viewUrl
                      ? "text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
                      : "pointer-events-none text-rc-faint"
                  }`}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Open in a new tab
                </a>
                <span className="ml-auto truncate text-[11px] text-rc-faint">{month.fileName}</span>
              </div>
            </div>
          )}

          {/* Sign it, replace it, or upload it — the real card, minus the
              header and file row the dialog has already shown. */}
          <div className="px-5 py-4">
            <TrustMonthCard
              month={month}
              agencyId={agencyId}
              trustAccountId={trustAccountId}
              accountName={accountName}
              canUpload={canUpload}
              canSign={canSign}
              signerName={signerName}
              embedded
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
