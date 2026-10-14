"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import {
  attachLicenceDocument,
  readLicenceFromDocument,
  removeLicenceDocument,
  updateLicence,
  type ActionState,
  type LicenceReadResult,
} from "@/lib/actions/licences";
import { useFileDrop } from "@/lib/use-file-drop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildLicenceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import { LICENCE_CATEGORY_LABELS, cleanLicenceCategories } from "@/lib/rules/nsw-cpd";
import { LicenceTypes } from "@/components/registers/LicenceTypes";
import { ReminderLine, type ReminderInfo } from "@/components/registers/ReminderLine";
import { LicenceReadNotice } from "@/components/registers/LicenceReadNotice";
import { parseReadState } from "@/lib/licence-read";
import { formatAuDate, formatAuTimestamp } from "@/lib/format-date";
import { useOnSaved } from "@/lib/use-on-saved";
import { useViewerAccess } from "@/components/ViewerAccess";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import type { CpdRecord, Profile } from "@/lib/types";

const initialState: ActionState = { error: null };

const LICENCE_TYPE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

export function StaffRegisterCard({
  profile,
  cpdRecords,
  viewerProfile,
  cpdYearLabel,
  cpdDone = false,
  reminderInfo = { next: null, last: null },
  nameOf = {},
  former = false,
}: {
  profile: Profile;
  cpdRecords: CpdRecord[];
  viewerProfile: Profile;
  cpdYearLabel: string;
  /** Ticked as done for the CPD year (cpd_year_signoffs). */
  cpdDone?: boolean;
  reminderInfo?: ReminderInfo;
  /** Profile id to display name, for "typed by" lines. */
  nameOf?: Record<string, string>;
  /** Someone who has left (archived): kept on the record, read-only. */
  former?: boolean;
}) {
  // Someone else's licence stays with the licensee IN CHARGE, not the agent
  // on their own plan: the database lets only them update another person's
  // profile ("profiles: licensee can update agency members", 0058).
  const canEdit = !former && (viewerProfile.id === profile.id || viewerProfile.is_licensee_in_charge);
  const { actsAsLicensee } = useViewerAccess();
  const categories = cleanLicenceCategories(profile.licence_categories);
  const status = expiryStatus(profile.licence_expiry);

  const licenceAction = updateLicence.bind(null, profile.id);
  const [licenceState, licenceFormAction, licencePending] = useActionState(licenceAction, initialState);
  const [editingLicence, setEditingLicence] = useState(false);
  useOnSaved(licencePending, licenceState.error, () => setEditingLicence(false));
  const [readResult, setReadResult] = useState<LicenceReadResult | null>(null);
  const readState = parseReadState(profile.licence_read);
  const detailsMissing = !profile.licence_type || !profile.licence_number || !profile.licence_expiry;

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-rc-ink">{profile.full_name ?? profile.email}</h3>
            {profile.is_licensee_in_charge && (
              <span className="rounded-full bg-rc-green/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rc-green-deep">
                Licensee
              </span>
            )}
            {former && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                Left the office
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-rc-muted">{profile.email}</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${EXPIRY_STATUS_STYLES[status]}`}>
          {EXPIRY_STATUS_LABELS[status]}
        </span>
      </div>

      <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
        {!editingLicence ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-neutral-600">
              {profile.licence_type ? (
                <>
                  <span className="font-medium text-rc-ink">{LICENCE_TYPE_LABELS[profile.licence_type]}</span>
                  {profile.licence_number && <> · {profile.licence_number}</>}
                  {profile.licence_expiry && <> · expires {formatAuDate(profile.licence_expiry)}</>}
                </>
              ) : (
                "No licence or certificate details on file yet."
              )}
              {/* Every type of licence held (14 Oct 2026). */}
              {categories.length > 0 && (
                <span className="mt-0.5 block text-xs text-rc-muted">
                  {categories.map((c) => LICENCE_CATEGORY_LABELS[c]).join(" · ")}
                </span>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setEditingLicence(true)}
                className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline"
              >
                Edit
              </button>
            )}
          </div>
        ) : (
          <form action={licenceFormAction} className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="licenceNumber"
                placeholder="Licence / certificate no."
                defaultValue={profile.licence_number ?? ""}
                className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="date"
                name="licenceExpiry"
                defaultValue={profile.licence_expiry ?? ""}
                className="rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            {/* The class and every type of licence held, ticked (Adam, 14 Oct
                2026). Replaces the single category of practice, which lived
                here and nowhere else (Adam, 18 Aug 2026). */}
            <LicenceTypes profile={profile} />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={licencePending}
                className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingLicence(false)}
                className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-rc-muted hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {licenceState.error && <p className="text-xs text-rc-amber-deep">{licenceState.error}</p>}
          </form>
        )}
        {/* The document itself. Adam's ask was to hold the actual certificate
            of registration, not just its number — a register of typed numbers
            proves nothing to an auditor, and the person who typed it is the
            one who'd have to find the PDF again. Visible to everyone in the
            agency; only the holder and the licensee can change it. */}
        <LicenceDocument profile={profile} canEdit={canEdit} onResult={setReadResult} />
        <LicenceReadNotice
          state={readState}
          target={{ kind: "person", profileId: profile.id }}
          nameOf={nameOf}
          canEdit={canEdit}
          canReread={Boolean(actsAsLicensee && canEdit && profile.licence_document_path && detailsMissing)}
          onReread={() => readLicenceFromDocument(profile.id)}
          lastResult={readResult}
        />
        {former ? (
          // The job skips someone who has left, so no "Next reminder" here.
          <p className="mt-2 text-[11px] text-rc-faint">
            Reminders stopped when they left the office
            {reminderInfo.last ? ` · last sent ${formatAuTimestamp(reminderInfo.last)}` : ""}.
          </p>
        ) : (
          <ReminderLine info={reminderInfo} hasExpiry={Boolean(profile.licence_expiry)} />
        )}
      </div>

      {/* CPD summary only — the working screen is /dashboard/cpd now (Adam,
          18 Aug 2026: "we need a separate section for CPD"). Logging moved
          with it, which also fixed a real problem: this form never asked who
          delivered the training, and the provider is what decides whether an
          entry counts at all. */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2">
        {/* The year's tick, as the CPD page shows it (Adam, 14 Oct 2026: tick
            whether it's done; the certificate is optional). No hours. */}
        <p className="text-xs text-rc-muted">
          CPD {cpdYearLabel}:{" "}
          <span className={cpdDone ? "text-rc-green-deep" : "text-rc-amber-deep"}>
            {cpdDone ? "done" : "not confirmed yet"}
          </span>
          {cpdRecords.length > 0 && (
            <>
              {" "}
              · {cpdRecords.length} {cpdRecords.length === 1 ? "certificate" : "certificates"}
            </>
          )}
        </p>
        {!former && (
          <Link href="/dashboard/cpd" className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline">
            Manage CPD
          </Link>
        )}
      </div>
    </div>
  );
}

// Licence document — the "Upload licence document" action from the
// registers mockup. Same client-side-upload-then-record-path pattern as
// EvidenceUploader in ItemCard.tsx (a Server Action can't carry a real
// document upload — see the comment on uploadEvidenceObject).
function LicenceDocument({
  profile,
  canEdit,
  onResult,
}: {
  profile: Profile;
  canEdit: boolean;
  onResult: (result: LicenceReadResult) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState<false | "uploading" | "reading">(false);
  const [error, setError] = useState<string | null>(null);

  // "Upload certificate of registration" rather than "Upload licence
  // document" when that's what the person holds. An assistant agent told to
  // upload their licence goes looking for something they don't have.
  const uploadLabel =
    profile.licence_type === "certificate_of_registration" ? "certificate of registration" : "licence document";

  useEffect(() => {
    if (!profile.licence_document_path) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(profile.licence_document_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.licence_document_path]);

  // One path for a picked file and a dropped one — see useFileDrop.
  const drop = useFileDrop({ onFile: (f) => void upload(f), disabled: Boolean(uploading) });

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  }

  async function upload(file: File) {
    setError(null);
    setUploading("uploading");
    const supabase = createBrowserClient();
    const path = buildLicenceDocPath(profile.agency_id, profile.id, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    // Upload, don't type: the document is read and what it says is saved
    // straight to the record. See lib/licence-read.ts for what is and isn't.
    setUploading("reading");
    const result = await attachLicenceDocument(profile.id, path, stored.name);
    setUploading(false);
    onResult(result);
  }

  // One control for a first upload and for a renewal. A renewed licence is a
  // new document: uploading it reads the new expiry date, which restarts the
  // reminder schedule against it, and the old document stays in the history.
  const uploadControl = canEdit ? (
    // Drag as well as click (Adam, 9 Sep 2026). A one-line link is a small
    // drop target, so it grows a dashed outline while a file is over it.
    <label
      {...drop.dragProps}
      className={`cursor-pointer rounded-md px-1.5 py-0.5 transition ${
        drop.isOver
          ? "bg-rc-green-soft text-rc-green-deep outline-dashed outline-1 outline-rc-green-deep"
          : "text-rc-green-deep hover:underline"
      }`}
      title={`Drag a file here, or click. A PDF or a phone photo is fine.`}
    >
      {uploading === "uploading"
        ? "Uploading…"
        : uploading === "reading"
          ? "Reading the document…"
          : profile.licence_document_path
            ? "Upload renewed licence"
            : `Upload ${uploadLabel}`}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        onChange={handleFile}
        disabled={Boolean(uploading)}
        className="hidden"
      />
    </label>
  ) : null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {profile.licence_document_path ? (
        <>
          {signedUrl ? (
            <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-rc-green-deep hover:underline">
              <Paperclip size={12} /> {profile.licence_document_file_name ?? "View document"}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-rc-faint">
              <Paperclip size={12} /> loading link…
            </span>
          )}
          {uploadControl}
          {canEdit && (
            <button
              type="button"
              onClick={() => removeLicenceDocument(profile.id)}
              className="text-rc-faint hover:text-rc-amber-deep"
            >
              Remove
            </button>
          )}
        </>
      ) : canEdit ? (
        uploadControl
      ) : (
        <span className="text-rc-faint">No {uploadLabel} on file.</span>
      )}
      {(error ?? drop.dropError) && (
        <span className="text-rc-amber-deep">{error ?? drop.dropError}</span>
      )}
    </div>
  );
}
