"use client";

import { useActionState, useEffect, useState } from "react";
import { FileText, RefreshCw, X } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSignoffDocPath, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import {
  createSignoffDocument,
  replaceSignoffDocument,
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
}: {
  month: ReconciliationMonth;
  agencyId: string;
  trustAccountId: string;
  accountName: string;
  canUpload: boolean;
  canSign: boolean;
  /** Pre-fills the signature field with the licensee's own name. */
  signerName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState(signerName);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState<File | null>(null);

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
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!month.filePath) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(month.filePath, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [month.filePath]);

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
      className={`rounded-card border bg-white p-4 shadow-card ${
        late ? "border-rc-red/40" : "border-rc-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-rc-ink">{month.label}</p>
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

      {month.fileName && (
        <p className="mt-3 flex items-center gap-2 text-xs text-rc-muted">
          <FileText size={13} aria-hidden="true" className="shrink-0" />
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-rc-green-deep hover:underline"
            >
              {month.fileName}
            </a>
          ) : (
            <span className="truncate">{month.fileName}</span>
          )}
        </p>
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

      {/* Replace — the wrong month's report, a superseded export, a bad scan.
          Offered on a SIGNED month too, which is the whole point of the
          change: without it Adam had a July record holding August's figures
          and no way back. Signing again is not a formality here — see
          replaceSignoffDocument. */}
      {month.documentId && canSign && !replacing && (
        <button
          type="button"
          onClick={() => setReplacing(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
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

      {/* Uploaded, unsigned, and this person is the licensee. */}
      {month.documentId && month.status !== "signed" && canSign && (
        <form action={submitSign} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs font-medium text-rc-muted">
            Type your name to sign
            <input
              name="typedName"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
            />
          </label>
          <button
            type="submit"
            disabled={signing}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {signing ? "Signing…" : "Sign"}
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
