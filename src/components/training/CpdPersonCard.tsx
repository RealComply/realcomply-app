"use client";

import { useViewerAccess } from "@/components/ViewerAccess";
import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { Check, Paperclip, Trash2 } from "lucide-react";
import {
  addCpdFromCertificate,
  deleteCpdRecord,
  setCpdYearComplete,
  updateCpdRecord,
  type ActionState,
} from "@/lib/actions/registers";
import { useFileDrop } from "@/lib/use-file-drop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildCpdDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { formatAuDate } from "@/lib/format-date";
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
  // Someone who has left keeps their card as history, read only: nothing
  // to attach or tick for a person no longer in the office (browser
  // re-check, 10 Oct 2026).
  const left = Boolean(subject.archived_at);
  const canEdit = !left && (viewerProfile.id === subject.id || Boolean(viewerProfile.is_licensee_in_charge));
  const { actsAsLicensee } = useViewerAccess();
  const done = Boolean(signoff);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticking, setTicking] = useState(false);

  // One path for a picked file and a dropped one — see useFileDrop.
  const drop = useFileDrop({ onFile: (f) => void upload(f), disabled: uploading });

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  }

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    // Always cleared, and a thrown save says so (check, 10 Oct 2026): it left
    // the card on "Reading certificate…" with the drop zone off until a reload.
    try {
      const supabase = createBrowserClient();
      const path = buildCpdDocPath(subject.agency_id, subject.id, file.name);
      const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
      if (uploadError) {
        setError(uploadError);
        return;
      }
      const { error: saveError } = await addCpdFromCertificate(subject.id, path, stored.name);
      if (saveError) setError(saveError);
    } catch {
      setError("Couldn't save that certificate. Reload the page to see whether it was added, then try again.");
    } finally {
      setUploading(false);
    }
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
            {left && (
              <span className="rounded-full bg-rc-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rc-muted">
                Left the office
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

      {/* Drag as well as click (Adam, 9 Sep 2026). The dashed border already
          said "drop a file here" and nothing listened; a drop navigated the
          browser to the certificate instead. Uploads on drop, because this
          control already uploads the moment a file is picked — the two-step
          attach used elsewhere would be a different behaviour on the same
          card. */}
      {canEdit && (
        <label
          {...drop.dragProps}
          className={`mt-3 block cursor-pointer rounded-xl border border-dashed px-4 py-4 text-center transition ${
            drop.isOver
              ? "border-rc-green-deep bg-rc-green-soft"
              : "border-rc-border bg-white hover:border-rc-green-deep hover:bg-rc-green-soft"
          } ${uploading ? "opacity-60" : ""}`}
        >
          <span className="text-sm font-semibold text-rc-green-deep">
            {uploading ? "Reading certificate…" : "+ Attach certificate"}
          </span>
          <span className="mt-1 block text-[11px] text-rc-faint">
            PDF or photo — drag it here or click. RealComply reads the provider, topic, hours and date off it.
          </span>
          <input type="file" onChange={handleFile} disabled={uploading} className="hidden" />
        </label>
      )}
      {drop.dropError && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {drop.dropError}
        </p>
      )}
      {drop.tookFirstOnly && (
        <p className="mt-1.5 text-[11px] text-rc-muted">
          More than one file was dropped, so the first one was used. Attach the others one at a time.
        </p>
      )}

      <div className="mt-4 flex items-start gap-2.5 border-t border-rc-border pt-3">
        <button
          type="button"
          // Un-ticking removes the year's sign-off record, which only the
          // licensee may do (Adam, 9 Oct 2026).
          onClick={canEdit && (!done || actsAsLicensee) ? toggleDone : undefined}
          disabled={!canEdit || ticking || (done && !actsAsLicensee)}
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
  const { actsAsLicensee } = useViewerAccess();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  // Closes once the save has gone through, not as soon as it is sent (check,
  // 10 Oct 2026): a refused save ("Give the activity a name.") closed the form
  // and its message with it, so nothing was saved and nothing said so.
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const result = await updateCpdRecord(record.id, prev, fd);
    if (!result.error) setEditing(false);
    return result;
  }, initial);

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
  // Null when the certificate didn't state it (0051). Never shown as 0.
  const amount = record.hours === null || record.hours === undefined ? null : Number(record.hours);
  const missingHours = amount === null;
  const missingDate = !record.completed_date;
  const missingProvider = !record.provider;

  if (editing) {
    return (
      <form
        action={action}
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
            defaultValue={amount ?? ""}
            placeholder={isUnit ? "Units" : "Hours"}
            className="w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <input
            name="completedDate"
            type="date"
            defaultValue={record.completed_date ?? ""}
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
          {record.provider && <span className="font-normal text-rc-muted"> · {record.provider}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-rc-faint">
          {amount !== null && (
            <>
              {amount} {isUnit ? (amount === 1 ? "unit" : "units") : amount === 1 ? "hour" : "hours"} ·{" "}
            </>
          )}
          {record.completed_date ? <>completed {formatAuDate(record.completed_date)}</> : "completion date not read"}
          {record.notes && <> · {record.notes.replace(/^Delivery: /, "")}</>}
        </p>
        {/* Ask for exactly what the certificate didn't say, and nothing else.
            Until it has its hours, date and approved provider, the entry is
            shown but adds nothing to the year (lib/cpd-hours.ts). */}
        {(missingHours || missingDate || missingProvider) && (
          <MissingCpdFields
            record={record}
            missingHours={missingHours}
            missingDate={missingDate}
            missingProvider={missingProvider}
            isUnit={isUnit}
            canEdit={canEdit}
          />
        )}
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
            {/* Only the licensee deletes a CPD record (Adam, 9 Oct 2026). */}
            {actsAsLicensee && <button
              type="button"
              onClick={() => deleteCpdRecord(record.id)}
              aria-label="Remove"
              className="text-rc-faint transition hover:text-rc-amber-deep"
            >
              <Trash2 size={13} />
            </button>}
          </>
        )}
      </div>
    </div>
  );
}

function MissingCpdFields({
  record,
  missingHours,
  missingDate,
  missingProvider,
  isUnit,
  canEdit,
}: {
  record: CpdRecord;
  missingHours: boolean;
  missingDate: boolean;
  missingProvider: boolean;
  isUnit: boolean;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateCpdRecord.bind(null, record.id), initial);
  const what = [
    missingHours ? (isUnit ? "units" : "hours") : null,
    missingDate ? "completion date" : null,
    missingProvider ? "approved provider" : null,
  ].filter(Boolean) as string[];
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0];

  return (
    <form action={action} className="mt-1.5 rounded-md border border-rc-amber/40 bg-rc-amber/10 px-2 py-1.5 text-[11px]">
      <p className="text-rc-amber-deep">
        The certificate doesn&rsquo;t show the {list}. {canEdit ? `Add ${what.length === 1 ? "it" : "them"} here. ` : ""}
        It doesn&rsquo;t count toward CPD hours until it has {what.length === 1 ? "it" : "them"}.
      </p>
      {canEdit && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {/* The fields already read go back unchanged. */}
          <input type="hidden" name="activityName" value={record.activity_name} />
          {!missingProvider && <input type="hidden" name="provider" value={record.provider ?? ""} />}
          {!missingHours && <input type="hidden" name="hours" value={String(record.hours ?? "")} />}
          {missingProvider && (
            <input name="provider" placeholder="Approved provider" className="w-40 rounded-md border border-rc-border px-2 py-0.5 text-xs" />
          )}
          {missingHours && (
            <input
              name="hours"
              type="number"
              step="0.5"
              min="0"
              placeholder={isUnit ? "Units" : "Hours"}
              className="w-20 rounded-md border border-rc-border px-2 py-0.5 text-xs"
            />
          )}
          {missingDate && (
            <input name="completedDate" type="date" className="rounded-md border border-rc-border px-2 py-0.5 text-xs" />
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rc-green-deep px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}
      {state.error && <p className="mt-1 text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
