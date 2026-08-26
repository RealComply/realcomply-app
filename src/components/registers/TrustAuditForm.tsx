"use client";

import { useActionState, useState } from "react";
import { Check, FileText } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSignoffDocPath } from "@/lib/storage/evidence";
import { saveTrustAudit, type ActionState } from "@/lib/actions/trust-account";
import { formatAuDate } from "@/lib/format-date";
import type { TrustAudit } from "@/lib/types";

// The annual trust account audit — s111 and s112, Property and Stock Agents
// Act 2002 (NSW).
//
// The tick is the point of the screen, but it is deliberately not a bare
// checkbox that writes true. It records WHO confirmed and WHEN, alongside the
// auditor and the report, because "the audit happened" is an assertion a named
// person makes and a tick with nobody behind it is not evidence of anything.
//
// Licensee-only, with no assistant exception — unlike the monthly
// reconciliation. s111 puts the obligation on the licensee personally.

const initial: ActionState = { error: null };

export function TrustAuditForm({
  agencyId,
  trustAccountId,
  accountName,
  periodEnd,
  dueOn,
  daysToDue,
  audit,
  confirmedByName,
  canEdit,
}: {
  agencyId: string;
  trustAccountId: string;
  accountName: string;
  periodEnd: string;
  dueOn: string;
  daysToDue: number;
  audit: TrustAudit | null;
  confirmedByName: string | null;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveTrustAudit, initial);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState(audit?.file_path ?? "");
  const [fileName, setFileName] = useState(audit?.file_name ?? "");
  const [confirmed, setConfirmed] = useState(Boolean(audit?.confirmed_at));

  async function handleChoose(chosen: File | null) {
    setUploadError(null);
    setFile(chosen);
    if (!chosen) return;

    setUploading(true);
    const supabase = createBrowserClient();
    const path = buildSignoffDocPath(agencyId, "trust_audit", chosen.name);
    const { error, file: stored } = await uploadEvidenceObject(supabase, { path, file: chosen });
    setUploading(false);
    if (error) {
      setUploadError(error);
      return;
    }
    setFilePath(path);
    setFileName(stored.name);
  }

  const overdue = daysToDue < 0;

  return (
    <form action={action} className="rounded-card border border-rc-border bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-rc-ink">Annual audit — {accountName}</h3>
          <p className="mt-1 text-xs text-rc-muted">
            Audit period: year ended {formatAuDate(periodEnd)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
            confirmed
              ? "bg-rc-green-soft text-rc-green-deep"
              : overdue
                ? "bg-rc-red-soft text-rc-red"
                : "bg-rc-amber/15 text-rc-amber-deep"
          }`}
        >
          {confirmed
            ? "Confirmed"
            : overdue
              ? `Overdue by ${Math.abs(daysToDue)} days`
              : `Due ${formatAuDate(dueOn)} — ${daysToDue} days`}
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-rc-faint">
        s111 and s112, Property and Stock Agents Act 2002 (NSW) — the audit period is the year ending
        30 June, the audit must be carried out within 3 months of it ending, and the auditor&rsquo;s report
        is kept for at least 3 years. One audit per account per year.
      </p>

      <input type="hidden" name="periodEnd" value={periodEnd} />
      <input type="hidden" name="trustAccountId" value={trustAccountId} />
      <input type="hidden" name="filePath" value={filePath} />
      <input type="hidden" name="fileName" value={fileName} />
      <input type="hidden" name="confirmed" value={confirmed ? "yes" : "no"} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-rc-muted">
          Auditor
          <input
            name="auditorName"
            defaultValue={audit?.auditor_name ?? ""}
            disabled={!canEdit}
            placeholder="Name and firm"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep disabled:bg-rc-bg-alt"
          />
        </label>
        <label className="text-xs font-medium text-rc-muted">
          Date the report was received
          <input
            type="date"
            name="reportReceivedOn"
            defaultValue={audit?.report_received_on ?? ""}
            disabled={!canEdit}
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep disabled:bg-rc-bg-alt"
          />
        </label>
      </div>

      {fileName ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2 text-xs text-rc-muted">
          <FileText size={13} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{fileName}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setFilePath("");
                setFileName("");
                setFile(null);
              }}
              className="ml-auto shrink-0 text-rc-faint transition hover:text-rc-amber-deep hover:underline"
            >
              Replace
            </button>
          )}
        </p>
      ) : (
        canEdit && (
          <div className="mt-3">
            <FileDropZone
              compact
              file={file}
              onFile={handleChoose}
              disabled={uploading}
              label="Drag the auditor&rsquo;s report here, or click to browse"
            />
          </div>
        )
      )}

      {canEdit && (
        <button
          type="button"
          onClick={() => setConfirmed((v) => !v)}
          aria-pressed={confirmed}
          className="mt-4 flex w-full items-start gap-3 rounded-xl border border-rc-border bg-white p-4 text-left transition hover:border-rc-green-deep/40"
        >
          <span
            className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border ${
              confirmed ? "border-rc-green-deep bg-rc-green-deep" : "border-[#cfdad5]"
            }`}
          >
            {confirmed && <Check size={13} strokeWidth={3.4} className="text-white" aria-hidden="true" />}
          </span>
          <span>
            <span className="block text-sm font-semibold text-rc-ink">
              {confirmed
                ? `Audit for the year ended ${formatAuDate(periodEnd)} confirmed`
                : "Confirm the audit for this period has been carried out"}
            </span>
            <span className={`mt-0.5 block text-xs ${confirmed ? "text-rc-green-deep" : "text-rc-muted"}`}>
              {confirmed && audit?.confirmed_at && confirmedByName
                ? `${confirmedByName}, ${formatAuDate(audit.confirmed_at.slice(0, 10))}`
                : "Your name and the date are recorded against this confirmation."}
            </span>
          </span>
        </button>
      )}

      {!canEdit && (
        <p className="mt-4 rounded-xl border border-rc-border bg-rc-bg-alt px-4 py-3 text-xs text-rc-muted">
          {confirmed && confirmedByName && audit?.confirmed_at
            ? `Confirmed by ${confirmedByName} on ${formatAuDate(audit.confirmed_at.slice(0, 10))}.`
            : "Only the licensee in charge can record this."}
        </p>
      )}

      {canEdit && (
        <button
          type="submit"
          disabled={pending || uploading}
          className="mt-4 rounded-full bg-rc-green-deep px-5 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {uploading ? "Uploading…" : pending ? "Saving…" : "Save"}
        </button>
      )}

      {(uploadError ?? state.error) && (
        <p className="mt-2 text-xs text-rc-amber-deep" role="alert">
          {uploadError ?? state.error}
        </p>
      )}
      {state.saved && !state.error && !uploadError && (
        <p className="mt-2 text-xs font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
    </form>
  );
}
