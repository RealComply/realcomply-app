"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { updateLicence, addCpdRecord, deleteCpdRecord, finalizeLicenceDocument, removeLicenceDocument, type ActionState } from "@/lib/actions/registers";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildLicenceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { expiryStatus, EXPIRY_STATUS_STYLES, EXPIRY_STATUS_LABELS } from "@/lib/expiry-status";
import { CPD_HOURS_REQUIRED_AGENT, CPD_UNITS_REQUIRED_ASSISTANT } from "@/lib/cpd-year";
import type { CpdRecord, Profile } from "@/lib/types";

const initialState: ActionState = { error: null };

const LICENCE_TYPE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

const CPD_CATEGORY_LABELS: Record<string, string> = {
  general: "General CPD",
  fair_trading_forum: "Fair Trading forum",
  austrac_aml: "AUSTRAC AML training",
  assistant_unit: "Assistant unit",
};

export function StaffRegisterCard({
  profile,
  cpdRecords,
  viewerProfile,
  cpdYearLabel,
}: {
  profile: Profile;
  cpdRecords: CpdRecord[];
  viewerProfile: Profile;
  cpdYearLabel: string;
}) {
  const canEdit = viewerProfile.id === profile.id || viewerProfile.is_licensee_in_charge;
  const isAssistant = profile.licence_type === "certificate_of_registration";
  const target = isAssistant ? CPD_UNITS_REQUIRED_ASSISTANT : CPD_HOURS_REQUIRED_AGENT;
  const totalHours = cpdRecords.reduce((sum, r) => sum + Number(r.hours), 0);
  const status = expiryStatus(profile.licence_expiry);

  const licenceAction = updateLicence.bind(null, profile.id);
  const [licenceState, licenceFormAction, licencePending] = useActionState(licenceAction, initialState);
  const [editingLicence, setEditingLicence] = useState(false);

  const cpdAction = addCpdRecord.bind(null, profile.id);
  const [cpdState, cpdFormAction, cpdPending] = useActionState(cpdAction, initialState);
  const [addingCpd, setAddingCpd] = useState(false);

  return (
    <div className="rounded-lg border border-rc-border p-4">
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
          <p className="mt-0.5 text-xs text-neutral-500">{profile.email}</p>
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
                "No licence details on file yet."
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
                <option value="">Licence type…</option>
                <option value="class_1">Class 1 licence</option>
                <option value="class_2">Class 2 licence</option>
                <option value="certificate_of_registration">Certificate of registration</option>
              </select>
              <input
                type="text"
                name="licenceNumber"
                placeholder="Licence number"
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
                className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
              >
                Cancel
              </button>
            </div>
            {licenceState.error && <p className="text-xs text-rc-amber-deep">{licenceState.error}</p>}
          </form>
        )}
        {canEdit && <LicenceDocument profile={profile} />}
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-neutral-500">
            CPD {cpdYearLabel} — {totalHours}/{target} {isAssistant ? "units" : "hrs"}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddingCpd((v) => !v)}
              className="text-xs font-medium text-rc-green-deep hover:underline"
            >
              {addingCpd ? "Cancel" : "+ Log CPD"}
            </button>
          )}
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full ${totalHours >= target ? "bg-rc-green-deep" : "bg-rc-amber-deep"}`}
            style={{ width: `${Math.min(100, (totalHours / target) * 100)}%` }}
          />
        </div>

        {cpdRecords.length > 0 && (
          <ul className="mt-2 space-y-1">
            {cpdRecords.map((r) => (
              <li key={r.id} className="flex items-center justify-between text-xs text-neutral-600">
                <span>
                  {r.activity_name} — {CPD_CATEGORY_LABELS[r.category] ?? r.category} · {r.hours}
                  {isAssistant && r.category === "assistant_unit" ? "u" : "h"} · {r.completed_date}
                </span>
                {canEdit && (
                  <form action={deleteCpdRecord.bind(null, r.id)}>
                    <button type="submit" className="text-neutral-400 hover:text-rc-amber-deep">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {addingCpd && (
          <form
            action={async (formData) => {
              await cpdFormAction(formData);
              setAddingCpd(false);
            }}
            className="mt-2 space-y-2 rounded-md border border-rc-border p-2"
          >
            <input
              type="text"
              name="activityName"
              placeholder="Activity name (e.g. 'Underquoting update webinar')"
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select name="category" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="general">General CPD</option>
                <option value="fair_trading_forum">Fair Trading forum</option>
                <option value="austrac_aml">AUSTRAC AML training</option>
                <option value="assistant_unit">Assistant unit</option>
              </select>
              <input
                type="number"
                step="0.5"
                min="0"
                name="hours"
                placeholder={isAssistant ? "Units" : "Hours"}
                className="w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input type="date" name="completedDate" className="rounded-md border border-rc-border px-2 py-1 text-sm" />
            </div>
            <textarea
              name="notes"
              placeholder="Notes (optional)"
              rows={1}
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={cpdPending}
              className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
            {cpdState.error && <p className="text-xs text-rc-amber-deep">{cpdState.error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

// Licence document — the "Upload licence document" action from the
// registers mockup. Same client-side-upload-then-record-path pattern as
// EvidenceUploader in ItemCard.tsx (a Server Action can't carry a real
// document upload — see the comment on uploadEvidenceObject).
function LicenceDocument({ profile }: { profile: Profile }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="text-rc-green-deep hover:underline">
              📎 {profile.licence_document_file_name ?? "View document"}
            </a>
          ) : (
            <span className="text-neutral-400">📎 loading link…</span>
          )}
          <button
            type="button"
            onClick={() => removeLicenceDocument(profile.id)}
            className="text-neutral-400 hover:text-rc-amber-deep"
          >
            Remove
          </button>
        </>
      ) : (
        <label className="cursor-pointer text-rc-green-deep hover:underline">
          {uploading ? "Uploading…" : "Upload licence document"}
          <input type="file" onChange={handleFile} disabled={uploading} className="hidden" />
        </label>
      )}
      {error && <span className="text-rc-amber-deep">{error}</span>}
    </div>
  );
}
