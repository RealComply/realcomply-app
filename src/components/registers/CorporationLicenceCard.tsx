"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { Building2, Paperclip } from "lucide-react";
import {
  attachCorporationLicenceDocument,
  readCorporationLicenceFromDocument,
  removeCorporationLicenceDocument,
  updateCorporationLicence,
  type ActionState,
  type LicenceReadResult,
} from "@/lib/actions/licences";
import { expiryStatus } from "@/lib/expiry-status";
import { formatAuDate } from "@/lib/format-date";
import { parseReadState } from "@/lib/licence-read";
import { useFileDrop } from "@/lib/use-file-drop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildCorporationLicenceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { ReminderLine, type ReminderInfo } from "@/components/registers/ReminderLine";
import { LicenceReadNotice } from "@/components/registers/LicenceReadNotice";
import type { Agency } from "@/lib/types";

// The corporation's own licence.
//
// The Licence register listed one card per person and had nowhere for the
// entity's licence, which in NSW is a separate licence the company holds in
// its own right (Adam, 15 Aug 2026: "there's nowhere to put the corporation
// licence"). It sits above the staff cards because it is the licence the
// office trades under: the individuals' licences hang off it, not the other
// way around.
//
// Oct 2026: the licence document can be uploaded here too (0051), and is read
// the same way a person's is: holder, number and expiry saved straight from
// the document, anything unclear asked for on its own, and nothing saved if
// the holder named on it isn't this agency.
//
// Read-only for an agent, editable by the licensee in charge, matching how
// the insurance policies behave. An agent still needs to see it: they are the
// ones who put the licence number on advertising.
//
// Since the agent access change (0058) it is shown to the licensee only (the
// agent on their own plan included): an agent can no longer open the
// corporation licence document or its reminders, so the card would show them
// a link that never loads. LicencePanel decides; canEdit stays for safety.

const initial: ActionState = { error: null };

export function CorporationLicenceCard({
  agency,
  canEdit,
  reminderInfo = { next: null, last: null },
  nameOf = {},
}: {
  agency: Agency;
  canEdit: boolean;
  reminderInfo?: ReminderInfo;
  nameOf?: Record<string, string>;
}) {
  const holder = agency.corporation_licence_holder ?? null;
  const licenceNumber = agency.corporation_licence_number ?? null;
  const expiry = agency.corporation_licence_expiry ?? null;
  const documentPath = agency.corporation_licence_document_path ?? null;
  const documentName = agency.corporation_licence_document_file_name ?? null;

  const [state, action, pending] = useActionState(updateCorporationLicence, initial);
  const [editing, setEditing] = useState(false);
  const [readResult, setReadResult] = useState<LicenceReadResult | null>(null);
  const readState = parseReadState(agency.corporation_licence_read);
  const status = expiryStatus(expiry);

  const statusLabel =
    !expiry
      ? null
      : status === "expired"
        ? { text: "Expired", cls: "bg-rc-red-soft text-rc-red" }
        : status === "urgent"
          ? { text: "Expires within 30 days", cls: "bg-rc-amber/15 text-rc-amber-deep" }
          : { text: "Current", cls: "bg-rc-green-soft text-rc-green-deep" };

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: "var(--rc-badge-grad-green)" }}
            aria-hidden="true"
          >
            <Building2 size={15} strokeWidth={2} color="#0ca678" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-rc-ink">Corporation licence</h3>
            <p className="text-xs text-rc-muted">
              The licence {holder || agency.name} holds as a company, separate from each person&rsquo;s own.
            </p>
          </div>
        </div>
        {statusLabel && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusLabel.cls}`}>
            {statusLabel.text}
          </span>
        )}
      </div>

      {!editing ? (
        <div className="mt-3">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <Read label="Licence holder" value={holder} />
            <Read label="Licence number" value={licenceNumber} />
            <Read label="Expires" value={expiry ? formatAuDate(expiry) : null} />
          </dl>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 text-xs font-medium text-rc-green-deep hover:underline"
            >
              Edit
            </button>
          )}
        </div>
      ) : (
        <form
          action={async (fd) => {
            await action(fd);
            setEditing(false);
          }}
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
        >
          <Field name="holder" label="Licence holder" defaultValue={holder ?? ""} placeholder={agency.name} />
          <Field name="licenceNumber" label="Licence number" defaultValue={licenceNumber ?? ""} />
          <Field name="expiry" label="Expires" defaultValue={expiry ?? ""} type="date" />
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
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
        </form>
      )}
      {state.error && (
        <p className="mt-2 text-sm font-medium text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}

      <CorporationDocument
        agencyId={agency.id}
        path={documentPath}
        fileName={documentName}
        canEdit={canEdit}
        onResult={setReadResult}
      />
      <LicenceReadNotice
        state={readState}
        target={{ kind: "corporation" }}
        nameOf={nameOf}
        canEdit={canEdit}
        canReread={Boolean(canEdit && documentPath && (!holder || !licenceNumber || !expiry))}
        onReread={() => readCorporationLicenceFromDocument()}
        lastResult={readResult}
      />

      {/* The corporation licence has no holder to email, so its reminders go
          to the licensee in charge alone. See lib/email/licence-reminders.ts. */}
      <ReminderLine info={reminderInfo} hasExpiry={Boolean(expiry)} />
    </div>
  );
}

function CorporationDocument({
  agencyId,
  path,
  fileName,
  canEdit,
  onResult,
}: {
  agencyId: string;
  path: string | null;
  fileName: string | null;
  canEdit: boolean;
  onResult: (r: LicenceReadResult) => void;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<false | "uploading" | "reading">(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    createBrowserClient()
      .storage.from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const drop = useFileDrop({ onFile: (f) => void upload(f), disabled: Boolean(busy) });

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  }

  async function upload(file: File) {
    setError(null);
    setBusy("uploading");
    const supabase = createBrowserClient();
    const storagePath = buildCorporationLicenceDocPath(agencyId, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path: storagePath, file });
    if (uploadError) {
      setError(uploadError);
      setBusy(false);
      return;
    }
    setBusy("reading");
    const result = await attachCorporationLicenceDocument(storagePath, stored.name);
    setBusy(false);
    onResult(result);
  }

  const control = canEdit ? (
    <label
      {...drop.dragProps}
      className={`cursor-pointer rounded-md px-1.5 py-0.5 transition ${
        drop.isOver
          ? "bg-rc-green-soft text-rc-green-deep outline-dashed outline-1 outline-rc-green-deep"
          : "text-rc-green-deep hover:underline"
      }`}
      title="Drag a file here, or click. A PDF or a phone photo is fine."
    >
      {busy === "uploading"
        ? "Uploading…"
        : busy === "reading"
          ? "Reading the document…"
          : path
            ? "Upload renewed licence"
            : "Upload corporation licence"}
      <input
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        onChange={handleFile}
        disabled={Boolean(busy)}
        className="hidden"
      />
    </label>
  ) : null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      {path ? (
        <>
          {signedUrl ? (
            <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-rc-green-deep hover:underline">
              <Paperclip size={12} /> {fileName ?? "View document"}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-rc-faint">
              <Paperclip size={12} /> loading link…
            </span>
          )}
          {control}
          {canEdit && (
            <button
              type="button"
              onClick={() => removeCorporationLicenceDocument()}
              className="text-rc-faint hover:text-rc-amber-deep"
            >
              Remove
            </button>
          )}
        </>
      ) : canEdit ? (
        control
      ) : (
        <span className="text-rc-faint">No corporation licence document on file.</span>
      )}
      {(error ?? drop.dropError) && <span className="text-rc-amber-deep">{error ?? drop.dropError}</span>}
    </div>
  );
}

function Read({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-rc-muted">{label}</dt>
      <dd className="text-sm text-rc-ink">{value || <span className="text-rc-faint">Not recorded</span>}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  placeholder,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-rc-muted">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
    </label>
  );
}
