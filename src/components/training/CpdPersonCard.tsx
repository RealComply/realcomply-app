"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { Check, Paperclip, Trash2 } from "lucide-react";
import {
  addCpdFromCertificate,
  deleteCpdRecord,
  setCpdYearComplete,
  updateCpdRecord,
  type ActionState,
} from "@/lib/actions/registers";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildCpdDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import type { CpdRecord, CpdYearSignoff, Profile } from "@/lib/types";

const initial: ActionState = { error: null };

const LICENCE_LABELS: Record<string, string> = {
  class_1: "Class 1 licence",
  class_2: "Class 2 licence",
  certificate_of_registration: "Certificate of registration",
};

// One person's CPD for the year: their certificates, and a tick.
//
// Rebuilt 18 Aug 2026. The previous version asked for a category of practice,
// a provider, an activity name, hours and a date — every one of which is
// printed on the record of completion the provider issues. Adam: "all the
// information we need will be on the certificate. Less friction, less manual
// data entry." That is the product's own evidence model, and this screen had
// drifted from it.
export function CpdPersonCard({
  subject,
  viewerProfile,
  records,
  signoff,
  cpdYearStart,
  cpdYearLabel,
}: {
  subject: Profile;
  viewerProfile: Profile;
  records: CpdRecord[];
  signoff: CpdYearSignoff | null;
  cpdYearStart: string;
  cpdYearLabel: string;
}) {
  const canEdit = viewerProfile.id === subject.id || Boolean(viewerProfile.is_licensee_in_charge);
  const done = Boolean(signoff);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const path = buildCpdDocPath(subject.agency_id, subject.id, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    const { error: saveError } = await addCpdFromCertificate(subject.id, path, stored.name);
    setUploading(false);
    if (saveError) setError(saveError);
  }

  async function toggleDone() {
    setTicking(true);
    const { error: e } = await setCpdYearComplete(subject.id, cpdYearStart, !done);
    setTicking(false);
    if (e) setError(e);
  }

  return (
    <div className="rounded-card border border-rc-border bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-rc-ink">{subject.full_name ?? subject.email}</h3>
            {subject.is_licensee_in_charge && (
              <span className="rounded-full bg-rc-green/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rc-green-deep">
                Licensee
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-rc-muted">
            {subject.licence_type ? LICENCE_LABELS[subject.licence_type] : "No licence on file"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
            done ? "bg-rc-green/15 text-rc-green-deep" : "bg-rc-amber/20 text-rc-amber-deep"
          }`}
        >
          {done ? `Done for ${cpdYearLabel}` : "Not yet"}
        </span>
      </div>

      {records.map((r) => (
        <CertificateRow key={r.id} record={r} canEdit={canEdit} />
      ))}

      {canEdit && (
        <label
          className={`mt-3 block cursor-pointer rounded-xl border border-dashed border-rc-border bg-white px-4 py-4 text-center transition hover:border-rc-green-deep hover:bg-rc-green-soft ${
            uploading ? "opacity-60" : ""
          }`}
        >
          <span className="text-sm font-semibold text-rc-green-deep">
            {uploading ? "Reading certificate…" : "+ Attach certificate"}
          </span>
          <span className="mt-1 block text-[11px] text-rc-faint">
            PDF or photo. RealComply reads the provider, topic, hours and date off it.
          </span>
          <input type="file" onChange={handleFile} disabled={uploading} className="hidden" />
        </label>
      )}

      <div className="mt-4 flex items-start gap-2.5 border-t border-rc-border pt-3">
        <button
          type="button"
          onClick={canEdit ? toggleDone : undefined}
          disabled={!canEdit || ticking}
          aria-pressed={done}
          className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition ${
            done ? "border-rc-green-deep bg-rc-green-deep text-white" : "border-rc-border bg-white"
          } ${canEdit ? "cursor-pointer" : "cursor-default opacity-70"}`}
        >
          {done && <Check size={12} strokeWidth={3} />}
        </button>
        <div className="text-[13px]">
          <p className="font-medium text-rc-ink">CPD complete for {cpdYearLabel}</p>
          <p className="text-[11px] text-rc-faint">
            {signoff
              ? `Ticked ${signoff.confirmed_at.slice(0, 10)}`
              : canEdit
                ? "Tick once everything's done for the year"
                : "Not yet confirmed"}
          </p>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-rc-amber-deep">{error}</p>}
    </div>
  );
}

function CertificateRow({ record, canEdit }: { record: CpdRecord; canEdit: boolean }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateCpdRecord.bind(null, record.id), initial);

  useEffect(() => {
    if (!record.evidence_path) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(record.evidence_path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [record.evidence_path]);

  const isUnit = record.category === "assistant_unit";
  const amount = Number(record.hours);

  if (editing) {
    return (
      <form
        action={async (fd) => {
          await action(fd);
          setEditing(false);
        }}
        className="mt-3 space-y-2 rounded-xl border border-rc-border bg-neutral-50 p-3"
      >
        <p className="text-[11px] text-rc-muted">Fix anything the reading got wrong. The certificate stays attached.</p>
        <input
          name="activityName"
          defaultValue={record.activity_name}
          placeholder="Topic or unit"
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <input
            name="provider"
            defaultValue={record.provider ?? ""}
            placeholder="Provider"
            className="w-44 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <input
            name="hours"
            type="number"
            step="0.5"
            min="0"
            defaultValue={amount}
            placeholder={isUnit ? "Units" : "Hours"}
            className="w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <input
            name="completedDate"
            type="date"
            defaultValue={record.completed_date}
            className="rounded-md border border-rc-border px-2 py-1 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-rc-muted hover:bg-white"
          >
            Cancel
          </button>
        </div>
        {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
      </form>
    );
  }

  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded-xl border border-rc-border bg-white px-3.5 py-3">
      <div className="min-w-0">
        {/* Says where the values came from. The evidence model requires the
            source to be visible rather than a silently-filled field — the
            agent should always be able to see what was read, and correct it. */}
        <span className="mb-1.5 inline-block rounded bg-rc-green-soft px-1.5 py-0.5 text-[10px] font-semibold text-rc-green-deep">
          Read from certificate
        </span>
        <p className="text-[13px] font-medium text-rc-ink">
          {record.activity_name}
          {record.provider && <span className="font-normal text-rc-muted"> — {record.provider}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-rc-faint">
          {amount > 0 && (
            <>
              {amount} {isUnit ? (amount === 1 ? "unit" : "units") : "hours"} ·{" "}
            </>
          )}
          completed {record.completed_date}
          {record.notes && <> · {record.notes.replace(/^Delivery: /, "")}</>}
        </p>
        {!record.provider && <p className="mt-1 text-[11px] text-rc-amber-deep">No provider read off this one — worth adding.</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-xs">
        {signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-rc-green-deep hover:underline"
          >
            <Paperclip size={11} /> View
          </a>
        ) : (
          <span className="text-rc-faint">…</span>
        )}
        {canEdit && (
          <>
            <button type="button" onClick={() => setEditing(true)} className="font-medium text-rc-muted hover:text-rc-ink">
              Edit
            </button>
            <button
              type="button"
              onClick={() => deleteCpdRecord(record.id)}
              aria-label="Remove"
              className="text-rc-faint transition hover:text-rc-amber-deep"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
