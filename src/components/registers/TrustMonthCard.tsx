"use client";

import { useActionState, useEffect, useState } from "react";
import { Download, Eye, FileText, PenLine, RefreshCw, X } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSignoffDocPath, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import {
  createSignoffDocument,
  replaceSignoffDocument,
  restampSignedDocument,
  signDocument,
  type ActionState,
} from "@/lib/actions/signoffs";
import { formatAuDate } from "@/lib/format-date";
import type { ReconciliationMonth } from "@/lib/trust-account";

// One month's reconciliation: upload it, then sign it.
//
// Two roles, deliberately separated. The upload is open to the licensee in
// charge OR their assistant (Adam, 25 Aug 2026) because it is clerical work —
// exporting a report out of Property Tree and putting it on file. The
// signature is the licensee's alone, and the server enforces both; the props
// below only decide what is worth rendering.

const initial: ActionState = { error: null };

export function TrustMonthCard({
  month,
  agencyId,
  trustAccountId,
  accountName,
  canUpload,
  canSign,
  signerName,
  embedded = false,
}: {
  month: ReconciliationMonth;
  agencyId: string;
  trustAccountId: string;
  accountName: string;
  canUpload: boolean;
  canSign: boolean;
  /** Pre-fills the signature field with the licensee's own name. */
  signerName: string;
  /**
   * Rendered inside TrustMonthDialog, which already shows the month heading
   * and the document. Drops the card's own chrome so the dialog is not two
   * copies of the same three facts, and keeps everything that DOES something —
   * upload, sign, replace — because that is why the dialog carries the card at
   * all rather than a read-only preview.
   */
  embedded?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState<File | null>(null);
  const [restamping, setRestamping] = useState(false);

  const signAction = signDocument.bind(null, month.documentId ?? "");
  const [signState, submitSign, signing] = useActionState(signAction, initial);

  // A link to the document itself, on every month that has one.
  //
  // Adam, 8 Sep 2026: "there's also no way for me to see which documents I've
  // reported and see the final signed version." The file name was printed as
  // plain text, so the one thing a licensee would want from a signed month —
  // to open what they signed — was the one thing the card could not do. That
  // matters beyond convenience: a signature is worth what the signer could
  // check, and a month he cannot reopen is a month he has to take on trust.
  // TWO urls, not one. Viewing and saving are different jobs and the
  // difference is a header: the plain signed URL opens the report in the
  // browser's own viewer, and the same URL asked for with `download` comes
  // back telling the browser to save it under the original file name instead.
  // Without the second one, "download" means right-click, Save as, and a file
  // called something like a UUID — Adam, 8 Sep 2026: "I want to be able to
  // actually click on the monthly card and be able to view the signed document
  // and download it if I need to."
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  // The signed copy where there is one — the report with its signature page —
  // and the upload otherwise. Same rule as the dialog; see the note there.
  const showPath = month.signedFilePath ?? month.filePath;
  const showName = month.signedFileName ?? month.fileName;

  useEffect(() => {
    if (!showPath) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    const bucket = supabase.storage.from(EVIDENCE_BUCKET);

    bucket.createSignedUrl(showPath, 3600).then(({ data }) => {
      if (!cancelled) setViewUrl(data?.signedUrl ?? null);
    });
    bucket.createSignedUrl(showPath, 3600, { download: showName ?? true }).then(({ data }) => {
      if (!cancelled) setDownloadUrl(data?.signedUrl ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [showPath, showName]);

  // Swapping the wrong report for the right one.
  //
  // The upload half is identical to a first upload; the difference is entirely
  // on the server, where replaceSignoffDocument voids the signature and writes
  // what happened into the record. See that function for why a silent swap
  // would be worse than the mistake it fixes.
  async function handleReplace() {
    if (!replacement || !month.documentId) {
      setError("Choose the correct report first.");
      return;
    }
    setError(null);
    setUploading(true);

    const supabase = createBrowserClient();
    const path = buildSignoffDocPath(agencyId, "trust_reconciliation", replacement.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, {
      path,
      file: replacement,
    });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }

    const { error: saveError } = await replaceSignoffDocument(month.documentId, {
      filePath: path,
      fileName: stored.name,
    });

    setUploading(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setReplacement(null);
    setReplacing(false);
  }

  // Adding the signature page to a month signed before the page existed.
  //
  // Not "sign it again" — see restampSignedDocument. The signature and its
  // date are untouched; this only builds the file that should have been built
  // at the time, and the page it produces carries the original date.
  async function handleRestamp() {
    if (!month.documentId) return;
    setError(null);
    setRestamping(true);
    const { error: stampError } = await restampSignedDocument(month.documentId);
    setRestamping(false);
    if (stampError) setError(stampError);
  }

  async function handleUpload() {
    if (!file) {
      setError("Choose the reconciliation report first.");
      return;
    }
    setError(null);
    setUploading(true);

    const supabase = createBrowserClient();
    const path = buildSignoffDocPath(agencyId, "trust_reconciliation", file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }

    const { error: saveError } = await createSignoffDocument({
      category: "trust_reconciliation",
      title: `${accountName} reconciliation — ${month.label}`,
      periodLabel: month.label,
      // The whole point of 0031: a machine-readable period, so a missing month
      // is knowable and a reminder can decide whether to fire.
      periodMonth: month.month,
      // Which account this reconciles. Two accounts means two reconciliations
      // every month, and without this they would be indistinguishable.
      trustAccountId,
      filePath: path,
      fileName: stored.name,
      notes: null,
      // Ignored by the server for this category, which forces licensee_only.
      signerScope: "licensee_only",
    });

    setUploading(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setFile(null);
  }

  const late = month.status === "overdue";

  return (
    <div
      className={
        embedded
          ? ""
          : `rounded-card border bg-white p-4 shadow-card ${
              late ? "border-rc-red/40" : "border-rc-border"
            }`
      }
    >
      {!embedded && (
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          {/* The month name opens the report too, because that is the thing
              the eye lands on first and Adam reached for it before he found
              anything else. Not the whole card: it holds a Replace button, a
              signature form and a file input, and a card-wide click target
              that swallows a stray tap into a new tab is worse than one that
              never offered. */}
          {viewUrl ? (
            <a
              href={viewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-bold text-rc-ink transition hover:text-rc-green-deep hover:underline"
            >
              {month.label}
            </a>
          ) : (
            <p className="text-sm font-bold text-rc-ink">{month.label}</p>
          )}
          <p className="mt-0.5 text-xs text-rc-muted">
            {month.status === "signed" && month.signedAt
              ? `Signed ${formatAuDate(month.signedAt.slice(0, 10))}${
                  month.signedName ? ` by ${month.signedName}` : ""
                }`
              : month.dueOn
                ? `Due ${formatAuDate(month.dueOn)}`
                : "Not due yet"}
            {month.uploadedByName ? ` · uploaded by ${month.uploadedByName}` : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
            month.status === "signed"
              ? "bg-rc-green-soft text-rc-green-deep"
              : late
                ? "bg-rc-red-soft text-rc-red"
                : "bg-rc-amber/15 text-rc-amber-deep"
          }`}
        >
          {month.status === "signed"
            ? "Signed"
            : late
              ? "Overdue"
              : month.documentId
                ? "Waiting on the licensee"
                : "Not uploaded"}
        </span>
      </div>
      )}

      {/* The document itself: name, open, save.
          Adam, 8 Sep 2026, on a month he had already signed: "I want to be
          able to actually click on the monthly card and be able to view the
          signed document and download it if I need to."

          Given its own bordered row rather than left as a line of text,
          because on a signed month this IS the card's purpose. Everything
          else on a completed month is history; the one live action is to open
          what was signed. A signature is worth what the signer could check,
          and until this existed a signed month could not be reopened at all.

          Both controls stay put while their URLs are being minted, disabled
          rather than absent — a button that appears a moment later is a button
          the eye has already skipped past. */}
      {month.fileName && !embedded && (
        <div className="mt-3 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2">
          <p className="flex items-center gap-2 text-xs text-rc-ink">
            <FileText size={13} aria-hidden="true" className="shrink-0 text-rc-muted" />
            <span className="truncate font-medium">{showName}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={viewUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!viewUrl}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                viewUrl
                  ? "bg-rc-green-deep text-white hover:bg-rc-green-deep-600"
                  : "pointer-events-none bg-rc-green-deep/40 text-white"
              }`}
            >
              <Eye size={12} aria-hidden="true" />
              {month.status === "signed" ? "View signed report" : "View report"}
            </a>
            <a
              href={downloadUrl ?? undefined}
              aria-disabled={!downloadUrl}
              className={`inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold transition ${
                downloadUrl
                  ? "text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
                  : "pointer-events-none text-rc-faint"
              }`}
            >
              <Download size={12} aria-hidden="true" />
              Download
            </a>
          </div>
        </div>
      )}

      {/* The amendment history, on the face of the card rather than buried.
          A record that was corrected should say so where the person relying
          on it is looking — that is the difference between an amended record
          and an altered one. */}
      {month.notes && (
        <p className="mt-2 whitespace-pre-line rounded-lg border border-rc-border bg-rc-bg-alt px-2.5 py-1.5 text-[11px] leading-relaxed text-rc-muted">
          {month.notes}
        </p>
      )}

      {/* Signed, but the file has no signature page on it.
          Only ever true of months signed before 8 September 2026, when the
          signature page shipped. Offered as its own amber row rather than a
          quiet button because until it is pressed, this month's report leaves
          the building looking unsigned — and the register says otherwise.

          Deliberately NOT "replace and re-sign", which is the other button on
          this card and would destroy the date the licensee actually reviewed
          it. See restampSignedDocument. */}
      {month.documentId && month.status === "signed" && !month.signedFilePath && canSign && (
        <div className="mt-3 rounded-lg border border-rc-amber/40 bg-rc-amber/5 p-3">
          <p className="text-xs font-bold text-rc-ink">This one has no signature page yet</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
            You signed it off before RealComply started adding the signature page to the document
            itself, so the file still opens as an unsigned report. Adding it now doesn&rsquo;t change
            your sign-off or its date
            {month.signedAt ? ` — the page will read ${formatAuDate(month.signedAt.slice(0, 10))}` : ""}.
          </p>
          <button
            type="button"
            onClick={handleRestamp}
            disabled={restamping}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            <PenLine size={12} aria-hidden="true" />
            {restamping ? "Adding it…" : "Add the signature page"}
          </button>
        </div>
      )}

      {/* Replace — the wrong month's report, a superseded export, a bad scan.
          Offered on a SIGNED month too, which is the whole point of the
          change: without it Adam had a July record holding August's figures
          and no way back. Signing again is not a formality here — see
          replaceSignoffDocument. */}
      {month.documentId && canSign && !replacing && (
        <button
          type="button"
          onClick={() => setReplacing(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
        >
          <RefreshCw size={12} aria-hidden="true" />
          {month.status === "signed" ? "Replace this report" : "Replace the file"}
        </button>
      )}

      {month.documentId && canSign && replacing && (
        <div className="mt-3 rounded-lg border border-rc-amber/40 bg-rc-amber/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold text-rc-ink">Replace {month.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
                {month.status === "signed" ? (
                  <>
                    Your signature on this month will be cleared and you&rsquo;ll need to sign again, so the
                    date on the record matches the day you actually checked the right report. The
                    replacement is noted on the card. The old file stays on the account.
                  </>
                ) : (
                  <>The file on this month will be swapped for the one you choose. Nothing is signed yet.</>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReplacing(false);
                setReplacement(null);
                setError(null);
              }}
              aria-label="Cancel replacing this report"
              className="shrink-0 rounded-full p-1 text-rc-faint transition hover:bg-white hover:text-rc-ink"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-2.5">
            <FileDropZone
              compact
              file={replacement}
              onFile={setReplacement}
              disabled={uploading}
              label="Drag the correct report here, or click to browse"
            />
          </div>
          <button
            type="button"
            onClick={handleReplace}
            disabled={uploading || !replacement}
            className="mt-3 rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {uploading ? "Replacing…" : "Replace and re-sign"}
          </button>
        </div>
      )}

      {/* Not uploaded yet, and this person may upload it. */}
      {!month.documentId && canUpload && (
        <div className="mt-3">
          <FileDropZone
            compact
            file={file}
            onFile={setFile}
            disabled={uploading}
            label="Drag the reconciliation report here, or click to browse"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading || !file}
            className="mt-3 rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {uploading ? "Uploading…" : `Upload ${month.label}`}
          </button>
        </div>
      )}

      {!month.documentId && !canUpload && (
        <p className="mt-3 text-xs text-rc-muted">
          Waiting on the licensee in charge or their assistant to upload it.
        </p>
      )}

      {/* Uploaded, not yet signed off, and this person is the licensee.

          A TICK, not a signature line. Adam, 8 Sep 2026: "we can just add a
          tick box stating that the licensee has reviewed the document and only
          the licensee can tick that box." Nothing in the trust provisions
          requires this statement to be signed, so what the licensee is really
          attesting is that they reviewed it — and the box says exactly that
          rather than borrowing the language of a signature the Act never asked
          for. The record underneath is unchanged: their name, off their
          authenticated profile, and the moment they ticked it.

          The label carries the attestation, not a heading above it. A tick
          whose meaning lives in a separate line of text is a tick people press
          without reading the meaning. */}
      {month.documentId && month.status !== "signed" && canSign && (
        <form action={submitSign} className="mt-3 rounded-lg border border-rc-green-deep/30 bg-rc-green-soft/40 p-3">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-rc-ink">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
              className="mt-0.5 accent-rc-green-deep"
            />
            <span>
              I have reviewed this reconciliation and I&rsquo;m signing it off.
              <span className="mt-0.5 block text-xs text-rc-muted">
                Recorded against your name, {signerName || "your account"}, with today&rsquo;s date, and added
                to the document as a signature page.
              </span>
            </span>
          </label>
          <button
            type="submit"
            disabled={signing || !reviewed}
            className="mt-2.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-50"
          >
            {signing ? "Signing off…" : "Sign off"}
          </button>
        </form>
      )}

      {month.documentId && month.status !== "signed" && !canSign && (
        <p className="mt-3 text-xs text-rc-muted">On file — waiting on the licensee in charge to sign it.</p>
      )}

      {(error ?? signState.error) && (
        <p className="mt-2 text-xs text-rc-amber-deep" role="alert">
          {error ?? signState.error}
        </p>
      )}
    </div>
  );
}
