"use client";

import { useState, type ChangeEvent } from "react";
import { AlertTriangle, Paperclip } from "lucide-react";
import { addOtherInsurance } from "@/lib/actions/insurance";
import { OTHER_INSURANCE, OTHER_INSURANCE_KINDS, OTHER_INSURANCE_NAME_MAX } from "@/lib/insurance-read";
import { useFileDrop } from "@/lib/use-file-drop";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildOtherInsuranceDocPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { ACCEPT } from "@/components/registers/InsuranceCard";
import type { OtherInsuranceKind } from "@/lib/types";

// "+ Add other insurance" (0078; mockup approved by Adam, 16 Oct 2026). One
// link under the three cards, and no empty cards for insurance an office
// doesn't hold. Open it, pick the type (or name your own), upload the
// certificate of currency or policy schedule, Save. The certificate is read
// like the three, and the policy only exists once it has been.
//
// The policy's id is made here so the certificate can go straight into that
// policy's own folder; the database checks it is there (0078).
export function AddOtherInsurance({ agencyId }: { agencyId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OtherInsuranceKind>("public_liability");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<false | "uploading" | "reading">(false);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const drop = useFileDrop({ onFile: choose, disabled: Boolean(busy) });

  function choose(f: File) {
    setFile(f);
    setError(null);
    setRefusal(null);
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) choose(f);
  }

  function reset() {
    setKind("public_liability");
    setName("");
    setFile(null);
    setError(null);
    setRefusal(null);
    drop.clearDropError();
  }

  async function save() {
    setError(null);
    setRefusal(null);
    if (kind === "other" && !name.trim()) {
      setError("Name the insurance.");
      return;
    }
    if (!file) {
      setError("Choose the certificate of currency or policy schedule.");
      return;
    }
    setBusy("uploading");
    const policyId = crypto.randomUUID();
    const path = buildOtherInsuranceDocPath(agencyId, policyId, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(createBrowserClient(), { path, file });
    if (uploadError) {
      setError(uploadError);
      setBusy(false);
      return;
    }
    setBusy("reading");
    const outcome = await addOtherInsurance({
      policyId,
      kind,
      name: kind === "other" ? name : null,
      path,
      fileName: stored.name,
    });
    setBusy(false);
    if (outcome.error) {
      setError(outcome.error);
    } else if (outcome.outcome === "not_a_certificate" || outcome.outcome === "wrong_cover") {
      // Nothing was added. The form stays as it was, for another file.
      setFile(null);
      setRefusal(outcome.message ?? null);
    } else {
      reset();
      setOpen(false);
      setAdded(outcome.message ?? null);
    }
  }

  const busyText = busy === "uploading" ? "Uploading…" : busy === "reading" ? "Reading the certificate…" : null;

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setAdded(null);
            setOpen(true);
          }}
          className="w-full rounded-card border border-dashed border-rc-border bg-white px-4 py-3 text-left text-sm font-semibold text-rc-green-deep transition hover:border-rc-green-deep"
        >
          + Add other insurance
        </button>
        {added && (
          <p role="status" className="mt-2 text-sm text-rc-green-deep">
            {added}
          </p>
        )}
      </div>
    );
  }

  return (
    <section
      aria-label="Add other insurance"
      className="space-y-3 rounded-card border border-rc-green-deep bg-white p-4 shadow-card"
    >
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-rc-ink">
        Type of insurance
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as OtherInsuranceKind)}
          disabled={Boolean(busy)}
          className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
        >
          {OTHER_INSURANCE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k === "other" ? "Other (name it)" : OTHER_INSURANCE[k].label}
            </option>
          ))}
        </select>
      </label>

      {kind === "other" && (
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-rc-ink">
          Name it
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={OTHER_INSURANCE_NAME_MAX}
            disabled={Boolean(busy)}
            placeholder="e.g. Management liability"
            className="rounded-md border border-rc-border bg-white px-2.5 py-2 text-sm font-normal text-rc-ink"
          />
        </label>
      )}

      <label
        {...drop.dragProps}
        className={`block cursor-pointer rounded-xl border-2 border-dashed p-4 text-center transition ${
          drop.isOver ? "border-rc-green-deep bg-rc-green-soft" : "border-rc-border hover:border-rc-green-deep"
        } ${busy ? "opacity-70" : ""}`}
      >
        {busyText ? (
          <span className="block text-sm font-bold text-rc-green-deep">{busyText}</span>
        ) : file ? (
          <>
            <span className="inline-flex max-w-full items-center gap-1.5 text-sm font-semibold text-rc-ink">
              <Paperclip size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{file.name}</span>
            </span>
            <span className="mt-1 block text-xs text-rc-muted">Click or drag to choose a different file.</span>
          </>
        ) : (
          <>
            <span className="block text-sm font-bold text-rc-green-deep">
              Upload the certificate of currency or policy schedule
            </span>
            <span className="mt-1 block text-xs text-rc-muted">
              PDF or a phone photo. We&apos;ll read the insurer, policy number and expiry.
            </span>
          </>
        )}
        <input type="file" accept={ACCEPT} onChange={handleFile} disabled={Boolean(busy)} className="hidden" />
      </label>

      {refusal && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-rc-red-soft px-3 py-2.5 text-sm text-rc-red">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{refusal}</span>
        </p>
      )}
      {(error ?? drop.dropError) && (
        <p role="alert" className="text-xs font-medium text-rc-amber-deep">
          {error ?? drop.dropError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={Boolean(busy)}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={Boolean(busy)}
          className="rounded-full border border-rc-border px-4 py-1.5 text-sm font-medium text-rc-muted hover:bg-neutral-100 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
