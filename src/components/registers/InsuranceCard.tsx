"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { AlertTriangle, Paperclip } from "lucide-react";
import {
  attachInsuranceCertificate,
  attachOtherInsuranceCertificate,
  removeInsuranceCertificate,
  removeOtherInsurance,
  saveInsuranceDetails,
  saveOtherInsuranceDetails,
  type ActionState,
  type InsuranceUploadResult,
} from "@/lib/actions/insurance";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import { formatAuDate, formatAuTimestamp } from "@/lib/format-date";
import {
  INSURANCE_FIELD_LABELS,
  OTHER_INSURANCE_NAME_MAX,
  joinAnd,
  parseInsuranceRead,
  provenanceLine,
  type HistoryEntry,
  type InsuranceField,
} from "@/lib/insurance-read";
import { useViewerAccess } from "@/components/ViewerAccess";
import { useOnSaved } from "@/lib/use-on-saved";
import { useFileDrop } from "@/lib/use-file-drop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildInsuranceDocPath, buildOtherInsuranceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import type { InsurancePolicyType, OtherInsuranceKind } from "@/lib/types";

const initialState: ActionState = { error: null };

export const ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif";

/**
 * Which policy a card is: one of the three on the office row, or one the
 * office added under them (0078). Everything else about the card is the same.
 */
export type InsuranceTarget =
  | { kind: "agency"; policy: InsurancePolicyType }
  | { kind: "other"; policyId: string; policyKind: OtherInsuranceKind; name: string | null };

function targetKey(target: InsuranceTarget): string {
  return target.kind === "agency" ? target.policy : target.policyId;
}

function saveActionFor(target: InsuranceTarget) {
  return target.kind === "agency"
    ? saveInsuranceDetails.bind(null, target.policy)
    : saveOtherInsuranceDetails.bind(null, target.policyId);
}

// One card per agency-level policy: PI, cyber, iCare workers (Adam, 13 Aug
// 2026). Since 15 Oct 2026 (0076; Trent's ask, mockup approved by Adam) each
// takes the certificate of currency or policy schedule: uploaded, read for
// the insurer, policy number and expiry, and one click to open when Fair
// Trading asks. A renewal moves the expiry on and keeps the previous
// certificate in the history below the card.
//
// Since 16 Oct 2026 (0078; mockup approved by Adam) the same card shows each
// policy an office adds under "Other insurance". There, Remove takes the
// policy off the register, after asking; for the three it takes the
// certificate off.
//
// The licensee's to maintain, which includes the agent on their own plan
// (lib/access.ts). The register itself is shown to no one else.
export function InsuranceCard({
  agencyId,
  target,
  title,
  note,
  insurer,
  policyNumber,
  expiry,
  documentPath,
  documentFileName,
  read,
  history,
  urlByPath,
  nameOf,
}: {
  agencyId: string;
  target: InsuranceTarget;
  title: string;
  note?: string;
  insurer: string | null;
  policyNumber: string | null;
  expiry: string | null;
  documentPath: string | null;
  documentFileName: string | null;
  read: unknown;
  history: HistoryEntry[];
  urlByPath: Record<string, string>;
  nameOf: Record<string, string>;
}) {
  // The licensee or an office manager (0093).
  const { runsOffice: canEdit } = useViewerAccess();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(saveActionFor(target), initialState);
  useOnSaved(pending, state.error, () => setEditing(false));

  const [busy, setBusy] = useState<false | "uploading" | "reading">(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<InsuranceUploadResult | null>(null);
  const [removing, startRemoving] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const status = expiryStatus(expiry);
  const readState = parseInsuranceRead(read);
  const certificateUrl = documentPath ? urlByPath[documentPath] ?? null : null;
  const hasDetails = Boolean(insurer || policyNumber || expiry);
  const missing = documentPath ? (readState?.missing ?? []) : [];
  const provenance = provenanceLine(readState, documentFileName, nameOf, formatAuTimestamp);
  const key = targetKey(target);
  const headingId = `insurance-${key}`;
  const named = target.kind === "other" && target.policyKind === "other";

  const drop = useFileDrop({ onFile: (f) => void upload(f), disabled: Boolean(busy) || !canEdit });

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  }

  async function upload(file: File) {
    setUploadError(null);
    setResult(null);
    setRemoveError(null);
    setBusy("uploading");
    const supabase = createBrowserClient();
    const path =
      target.kind === "agency"
        ? buildInsuranceDocPath(agencyId, target.policy, file.name)
        : buildOtherInsuranceDocPath(agencyId, target.policyId, file.name);
    const { error, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (error) {
      setUploadError(error);
      setBusy(false);
      return;
    }
    setBusy("reading");
    const outcome =
      target.kind === "agency"
        ? await attachInsuranceCertificate(target.policy, path, stored.name)
        : await attachOtherInsuranceCertificate(target.policyId, path, stored.name);
    setBusy(false);
    if (outcome.error) setUploadError(outcome.error);
    else setResult(outcome);
  }

  // An added policy asks first: Remove takes the whole policy off the
  // register. For the three it takes the certificate off, as before.
  function remove() {
    setResult(null);
    setRemoveError(null);
    if (target.kind === "other" && !confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    setConfirmingRemove(false);
    startRemoving(async () => {
      const r =
        target.kind === "agency" ? await removeInsuranceCertificate(target.policy) : await removeOtherInsurance(target.policyId);
      if (r.error) setRemoveError(r.error);
    });
  }

  const busyText = busy === "uploading" ? "Uploading…" : busy === "reading" ? "Reading the certificate…" : null;
  const refused = result?.outcome === "not_a_certificate" || result?.outcome === "wrong_cover";
  // "Please add it below" only while something is still to add: once the gap
  // is filled the message would point at a form that has gone (preview check,
  // 16 Oct 2026).
  const savedNote =
    result && (result.outcome === "saved" || (result.outcome === "saved_with_gaps" && missing.length > 0))
      ? result.message
      : null;

  return (
    <section aria-labelledby={headingId} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold text-rc-ink">
            {title}
          </h3>
          {note && <p className="mt-1 text-xs text-rc-muted">{note}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPIRY_STATUS_STYLES[status]}`}>
          {EXPIRY_STATUS_LABELS[status]}
        </span>
      </div>

      {/* The details: read off the certificate, or typed. */}
      <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
        {!editing ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-neutral-600">
              {hasDetails ? (
                <>
                  {insurer && <span className="font-semibold text-rc-ink">{insurer}</span>}
                  {(policyNumber || expiry) && (
                    <span className="block text-rc-muted sm:inline sm:text-neutral-600">
                      {insurer && <span className="hidden sm:inline"> · </span>}
                      {[policyNumber, expiry ? `expires ${formatAuDate(expiry)}` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </>
              ) : (
                "No details on file yet."
              )}
            </div>
            {canEdit && (hasDetails || missing.length === 0) && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={`shrink-0 py-1 text-xs font-semibold text-rc-green-deep hover:underline ${hasDetails && documentPath ? "hidden sm:inline" : ""}`}
              >
                {hasDetails ? "Edit" : "Type them instead"}
              </button>
            )}
          </div>
        ) : (
          <form action={formAction} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {named && target.kind === "other" && (
                <label className="flex flex-col gap-0.5 text-xs text-rc-muted">
                  Name
                  <input
                    id={`${key}-name`}
                    type="text"
                    name="name"
                    required
                    maxLength={OTHER_INSURANCE_NAME_MAX}
                    defaultValue={target.name ?? ""}
                    className="w-44 rounded-md border border-rc-border bg-white px-2 py-1 text-sm text-rc-ink"
                  />
                </label>
              )}
              <DetailInput field="insurer" defaultValue={insurer} idPrefix={key} />
              <DetailInput field="policyNumber" defaultValue={policyNumber} idPrefix={key} />
              <DetailInput field="expiry" defaultValue={expiry} idPrefix={key} />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-full border border-rc-border px-4 py-1.5 text-xs font-medium text-rc-muted hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {state.error && (
              <p className="text-xs font-medium text-rc-amber-deep" role="alert">
                {state.error}
              </p>
            )}
          </form>
        )}
      </div>

      {/* The certificate on file. */}
      {documentPath ? (
        <div className="mt-3 space-y-2">
          {certificateUrl && (
            <a
              href={certificateUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center gap-2 rounded-full border-2 border-rc-green-deep text-sm font-bold text-rc-green-deep sm:hidden"
            >
              <Paperclip size={16} aria-hidden="true" /> View certificate
            </a>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {certificateUrl ? (
              <a
                href={certificateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden min-w-0 items-center gap-1 font-semibold text-rc-green-deep hover:underline sm:inline-flex"
              >
                <Paperclip size={13} aria-hidden="true" />
                <span className="truncate">{documentFileName ?? "View certificate"}</span>
              </a>
            ) : (
              <span className="hidden items-center gap-1 text-rc-faint sm:inline-flex">
                <Paperclip size={13} aria-hidden="true" /> {documentFileName ?? "Certificate"} (link not available just now)
              </span>
            )}
            {canEdit && (
              <label
                {...drop.dragProps}
                className={`cursor-pointer rounded-md py-2 font-semibold transition sm:py-0.5 ${
                  drop.isOver
                    ? "bg-rc-green-soft px-1.5 text-rc-green-deep outline-dashed outline-1 outline-rc-green-deep"
                    : "text-rc-green-deep hover:underline"
                } ${busy ? "opacity-70" : ""}`}
                title="Drag a file here, or click. A PDF or a phone photo is fine."
              >
                {busyText ?? "Upload renewed certificate"}
                <input type="file" accept={ACCEPT} onChange={handleFile} disabled={Boolean(busy)} className="hidden" />
              </label>
            )}
            {canEdit && hasDetails && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="py-2 font-semibold text-rc-green-deep hover:underline sm:hidden"
              >
                Edit
              </button>
            )}
            {canEdit && !confirmingRemove && (
              <button
                type="button"
                onClick={remove}
                disabled={removing || Boolean(busy)}
                className="py-2 text-rc-faint transition hover:text-rc-amber-deep disabled:opacity-60 sm:py-0.5"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        </div>
      ) : canEdit ? (
        <label
          {...drop.dragProps}
          className={`mt-3 block cursor-pointer rounded-xl border-[1.5px] border-dashed p-4 text-center transition ${
            drop.isOver ? "border-rc-green-deep bg-rc-green-soft" : "border-rc-border hover:border-rc-green-deep"
          } ${busy ? "opacity-70" : ""}`}
        >
          <span className="block text-sm font-bold text-rc-green-deep">{busyText ?? "+ Upload certificate of currency"}</span>
          {!busy && (
            <span className="mt-1 block text-xs text-rc-muted">
              PDF or phone photo of the certificate of currency or policy schedule: drag it here or click. RealComply
              reads the insurer, policy number and expiry off it.
            </span>
          )}
          <input type="file" accept={ACCEPT} onChange={handleFile} disabled={Boolean(busy)} className="hidden" />
        </label>
      ) : null}

      {/* An added policy without a certificate (only ever by hand in the
          database) can still be taken off the register. */}
      {canEdit && target.kind === "other" && !documentPath && !confirmingRemove && (
        <button
          type="button"
          onClick={remove}
          disabled={removing || Boolean(busy)}
          className="mt-2 py-2 text-xs text-rc-faint transition hover:text-rc-amber-deep disabled:opacity-60 sm:py-0.5"
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      )}

      {confirmingRemove && (
        <div
          role="alertdialog"
          aria-labelledby={`${headingId}-remove`}
          className="mt-3 rounded-xl border border-rc-border bg-neutral-50 px-3 py-2.5 text-sm"
        >
          <p id={`${headingId}-remove`} className="text-rc-ink">
            Take {title} off the register? Its certificates and history stay in the office&apos;s records.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={remove}
              className="rounded-full bg-rc-amber-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="rounded-full border border-rc-border px-4 py-1.5 text-xs font-medium text-rc-muted hover:bg-neutral-100"
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      {/* What the read couldn't give, asked for on its own. */}
      {canEdit && missing.length > 0 && !editing && (
        <GapForm
          target={target}
          missing={missing}
          couldNotRead={readState?.lastRead?.status === "could_not_read"}
        />
      )}

      {refused && result?.message && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl bg-rc-red-soft px-3 py-2.5 text-sm text-rc-red"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{result.message}</span>
        </p>
      )}
      {savedNote && (
        <p role="status" className="mt-3 text-sm text-rc-green-deep">
          {savedNote}
        </p>
      )}
      {(uploadError ?? drop.dropError ?? removeError) && (
        <p role="alert" className="mt-2 text-xs font-medium text-rc-amber-deep">
          {uploadError ?? drop.dropError ?? removeError}
        </p>
      )}

      {provenance && <p className="mt-3 text-xs text-rc-muted">{provenance}</p>}

      {history.length > 0 && <History entries={history} urlByPath={urlByPath} />}
    </section>
  );
}

function DetailInput({
  field,
  defaultValue,
  idPrefix,
}: {
  field: InsuranceField;
  defaultValue: string | null;
  idPrefix: string;
}) {
  const label = field === "insurer" ? "Insurer" : field === "policyNumber" ? "Policy number" : "Expiry";
  return (
    <label className="flex flex-col gap-0.5 text-xs text-rc-muted">
      {label}
      <input
        id={`${idPrefix}-${field}`}
        type={field === "expiry" ? "date" : "text"}
        name={field}
        defaultValue={defaultValue ?? ""}
        className={`rounded-md border border-rc-border bg-white px-2 py-1 text-sm text-rc-ink ${field === "insurer" ? "w-44" : field === "policyNumber" ? "w-36" : ""}`}
      />
    </label>
  );
}

/**
 * Asks for what the read couldn't give. Only those fields are sent, so
 * answering one can never blank another.
 */
function GapForm({
  target,
  missing,
  couldNotRead,
}: {
  target: InsuranceTarget;
  missing: InsuranceField[];
  couldNotRead: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveActionFor(target), initialState);
  const labels = missing.map((f) => INSURANCE_FIELD_LABELS[f]);
  const lead = couldNotRead
    ? "The certificate couldn't be read, so the details need adding by hand. It stays attached."
    : `Couldn't read the ${joinAnd(labels)} from the certificate. Please add ${missing.length === 1 ? "it" : "them"}:`;
  return (
    <form
      action={formAction}
      className="mt-3 flex flex-col gap-2 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-3 py-2.5 text-sm"
    >
      <span className="text-rc-amber-deep">{lead}</span>
      <div className="flex flex-wrap items-end gap-2">
        {missing.map((f) => (
          <DetailInput key={f} field={f} defaultValue={null} idPrefix={targetKey(target)} />
        ))}
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error && (
        <p className="text-xs font-medium text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Every change to the policy, newest first, with each earlier certificate one click away. */
function History({ entries, urlByPath }: { entries: HistoryEntry[]; urlByPath: Record<string, string> }) {
  const earlier = entries.filter((e) => e.earlierCertificate).length;
  return (
    <details className="group mt-3 border-t border-rc-border pt-2 text-xs">
      <summary className="cursor-pointer py-1 font-semibold text-rc-muted hover:text-rc-ink">
        History{earlier > 0 ? ` (${earlier} earlier certificate${earlier === 1 ? "" : "s"})` : ""}
      </summary>
      <ul className="mt-2 space-y-2">
        {entries.map((e) => {
          const cert = e.earlierCertificate;
          const url = cert ? urlByPath[cert.path] : null;
          return (
            <li key={e.id} className="text-rc-muted">
              <span className="text-rc-ink">{e.text}</span>
              {cert && (
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-rc-green-deep hover:underline"
                    >
                      <Paperclip size={12} aria-hidden="true" /> {cert.fileName}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <Paperclip size={12} aria-hidden="true" /> {cert.fileName}
                    </span>
                  )}
                  {cert.details && <span>· {cert.details}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
