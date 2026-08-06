"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSgManualPath } from "@/lib/storage/evidence";
import { addSgManualVersion } from "@/lib/actions/registers";
import type { Profile } from "@/lib/types";

export function SgManualUploader({ profile, isFirstUpload }: { profile: Profile; isFirstUpload: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [versionLabel, setVersionLabel] = useState("");
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
    setError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const path = buildSgManualPath(profile.agency_id, file.name);
    const { error: uploadError } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    const { error: saveError } = await addSgManualVersion(path, file.name, versionLabel.trim() || null, notes.trim() || null);
    setUploading(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setFile(null);
    setVersionLabel("");
    setNotes("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border-2 border-dashed border-rc-border bg-neutral-50 p-5">
      <h3 className="text-base font-semibold text-rc-ink">
        {isFirstUpload ? "Upload your Supervision Guidelines Manual" : "Publish a new version"}
      </h3>
      <p className="text-xs text-neutral-500">PDF or Word document — this becomes the current version on file.</p>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-rc-border bg-white px-4 py-6 text-center transition hover:border-rc-green-deep hover:bg-rc-green/5">
        <span className="text-2xl">📄</span>
        <span className="text-sm font-medium text-rc-green-deep">
          {file ? file.name : "Click to choose a file"}
        </span>
        <input type="file" onChange={handleFile} className="hidden" />
      </label>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Version label (optional, e.g. 'v5')"
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          className="w-48 rounded-md border border-rc-border px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        placeholder="What changed (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={uploading || !file}
        className="rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {uploading ? "Uploading…" : isFirstUpload ? "Upload" : "Publish new version"}
      </button>
      {error && <p className="text-xs text-rc-amber-deep">{error}</p>}
    </form>
  );
}
