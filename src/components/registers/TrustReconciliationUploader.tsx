"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { FileText } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSignoffDocPath } from "@/lib/storage/evidence";
import { createSignoffDocument } from "@/lib/actions/signoffs";
import type { Profile } from "@/lib/types";

// Same upload shape as SgManualUploader (browser-side upload straight to
// Storage, then a short server action to record it — see the comment on
// uploadEvidenceObject for why), plus a period label since this is a
// recurring monthly document rather than a versioned one. Whatever trust
// account system the office uses (Property Tree, Console, etc.) exports the
// reconciliation report — this just gets that file on file and signed by
// the licensee, same pattern as everything else in this register.
export function TrustReconciliationUploader({ profile }: { profile: Profile }) {
  const [file, setFile] = useState<File | null>(null);
  const [periodLabel, setPeriodLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (!periodLabel.trim()) {
      setError("Enter which month this reconciliation covers (e.g. 'August 2026').");
      return;
    }
    setError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const path = buildSignoffDocPath(profile.agency_id, "trust_reconciliation", file.name);
    const { error: uploadError } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    const { error: saveError } = await createSignoffDocument({
      category: "trust_reconciliation",
      title: `Trust account reconciliation — ${periodLabel.trim()}`,
      periodLabel: periodLabel.trim(),
      filePath: path,
      fileName: file.name,
      notes: notes.trim() || null,
      signerScope: "licensee_only",
    });
    setUploading(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setFile(null);
    setPeriodLabel("");
    setNotes("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-card border-2 border-dashed border-rc-border bg-rc-bg-alt p-5">
      <h3 className="text-base font-semibold text-rc-ink">Upload a trust account reconciliation</h3>
      <p className="text-xs text-rc-muted">
        Export the month-end reconciliation from your trust account system and upload it here — you can review and
        sign it in RealComply, no printing.
      </p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-rc-border bg-white px-4 py-6 text-center transition hover:border-rc-green-deep hover:bg-rc-green-soft">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rc-green-soft text-rc-green-deep">
          <FileText size={20} />
        </span>
        <span className="text-sm font-medium text-rc-green-deep">{file ? file.name : "Click to choose a file"}</span>
        <input type="file" onChange={handleFile} className="hidden" />
      </label>

      <input
        type="text"
        placeholder="Which month? (e.g. 'August 2026')"
        value={periodLabel}
        onChange={(e) => setPeriodLabel(e.target.value)}
        className="w-56 rounded-lg border border-rc-border px-2 py-1.5 text-sm"
      />
      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full rounded-lg border border-rc-border px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={uploading || !file}
        className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {uploading ? "Uploading…" : "Upload for sign-off"}
      </button>
      {error && <p className="text-xs text-rc-amber-deep">{error}</p>}
    </form>
  );
}
