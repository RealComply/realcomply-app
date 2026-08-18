"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { updateLicence, finalizeLicenceDocument, removeLicenceDocument, type ActionState } from "@/lib/actions/registers";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildLicenceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import { CPD_PRACTICE_CATEGORY_LABELS, cpdRequirementFor } from "@/lib/rules/nsw-cpd";
import { ReminderLine, type ReminderInfo } from "@/components/registers/ReminderLine";
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
  reminderInfo = { next: null, last: null },
}: {
  profile: Profile;
  cpdRecords: CpdRecord[];
  viewerProfile: Profile;
  cpdYearLabel: string;
  reminderInfo?: ReminderInfo;
}) {
  const canEdit = viewerProfile.id === profile.id || viewerProfile.is_licensee_in_charge;
  const isAssistant = profile.licence_type === "certificate_of_registration";
  // Was a flat 7 hours for anyone holding a licence. Fair Trading sets hours
  // per CATEGORY of practice (7 residential sales / commercial / business
  // broking / stock & station, 6 strata, 4 on-site short-term RPM, and
  // residential property management not published for 2026–27), and Class 1
  // holders owe an accredited forum on top. A target of null means we can't
  // state a requirement — see rules/nsw-cpd.ts.
  const requirement = cpdRequirementFor(profile.licence_type, profile.cpd_practice_category);
  const target = requirement.units ?? requirement.coreHours;
  const totalHours = cpdRecords.reduce((sum, r) => sum + Number(r.hours), 0);
  const status = expiryStatus(profile.licence_expiry);

  const licenceAction = updateLicence.bind(null, profile.id);
  const [licenceState, licenceFormAction, licencePending] = useActionState(licenceAction, initialState);
  const [editingLicence, setEditingLicence] = useState(false);

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
                  {profile.licence_expiry && <> · expires {profile.licence_expiry}</>}
                </>
              ) : (
                "No licence or certificate details on file yet."
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
          <form
            action={async (formData) => {
              await licenceFormAction(formData);
              setEditingLicence(false);
            }}
            className="space-y-2"
          >
            <div className="flex flex-wrap gap-2">
              <select
                name="licenceType"
                defaultValue={profile.licence_type ?? ""}
                className="rounded-md border border-rc-border px-2 py-1 text-sm"
              >
                <option value="">Licence or certificate…</option>
                <option value="class_1">Class 1 licence</option>
                <option value="class_2">Class 2 licence</option>
                <option value="certificate_of_registration">Certificate of registration</option>
              </select>
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
            {/* Category of practice lives here and nowhere else (Adam, 18 Aug
                2026). Fair Trading sets CPD hours per category, so it has to
                be asked once — but it belongs beside someone's licence
                details, which change about as often, rather than being asked
                again on every CPD entry or training plan. Not shown for a
                certificate of registration: assistant agents are measured in
                units, and the category doesn't apply. */}
            {profile.licence_type !== "certificate_of_registration" && (
              <label className="block">
                <span className="block text-xs text-rc-muted">Category of practice (sets the CPD hours)</span>
                <select
                  name="cpdPracticeCategory"
                  defaultValue={profile.cpd_practice_category ?? ""}
                  className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
                >
                  <option value="">Not set</option>
                  {Object.entries(CPD_PRACTICE_CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
        <LicenceDocument profile={profile} canEdit={canEdit} />
        <ReminderLine info={reminderInfo} hasExpiry={Boolean(profile.licence_expiry)} />
      </div>

      {/* CPD summary only — the working screen is /dashboard/cpd now (Adam,
          18 Aug 2026: "we need a separate section for CPD"). Logging moved
          with it, which also fixed a real problem: this form never asked who
          delivered the training, and the provider is what decides whether an
          entry counts at all. */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2">
        <p className="text-xs text-rc-muted">
          {target === null ? (
            <>
              CPD {cpdYearLabel} — {totalHours} {isAssistant ? "units" : "hrs"} logged,{" "}
              <span className="text-rc-amber-deep">requirement not established</span>
            </>
          ) : (
            <>
              CPD {cpdYearLabel} —{" "}
              <span className={totalHours >= target ? "text-rc-green-deep" : "text-rc-amber-deep"}>
                {totalHours}/{target} {isAssistant ? "units" : "hrs"}
              </span>
            </>
          )}
        </p>
        <Link href="/dashboard/cpd" className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline">
          Manage CPD →
        </Link>
      </div>
    </div>
  );
}

// Licence document — the "Upload licence document" action from the
// registers mockup. Same client-side-upload-then-record-path pattern as
// EvidenceUploader in ItemCard.tsx (a Server Action can't carry a real
// document upload — see the comment on uploadEvidenceObject).
function LicenceDocument({ profile, canEdit }: { profile: Profile; canEdit: boolean }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const path = buildLicenceDocPath(profile.agency_id, profile.id, file.name);
    const { error: uploadError } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    const { error: saveError } = await finalizeLicenceDocument(profile.id, path, file.name);
    setUploading(false);
    if (saveError) setError(saveError);
  }

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
        <label className="cursor-pointer text-rc-green-deep hover:underline">
          {uploading ? "Uploading…" : `Upload ${uploadLabel}`}
          <input type="file" onChange={handleFile} disabled={uploading} className="hidden" />
        </label>
      ) : (
        <span className="text-rc-faint">No {uploadLabel} on file.</span>
      )}
      {error && <span className="text-rc-amber-deep">{error}</span>}
    </div>
  );
}
