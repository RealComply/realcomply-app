"use client";

import { useState, type FormEvent } from "react";
import { FileDropZone } from "@/components/FileDropZone";
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
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setError(uploadError);
      setUploading(false);
      return;
    }
    const { error: saveError } = await addSgManualVersion(path, stored.name, versionLabel.trim() || null, notes.trim() || null);
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
    <form onSubmit={handleSubmit} className="space-y-3 rounded-card border-2 border-dashed border-rc-border bg-rc-bg-alt p-5">
      <h3 className="text-base font-semibold text-rc-ink">
        {isFirstUpload ? "Upload your Supervision Guidelines Manual" : "Publish a new version"}
      </h3>
      <p className="text-xs text-rc-muted">PDF or Word document — this becomes the current version on file.</p>

      {/* The real drop zone, not a look-alike.
          Adam, 9 Sep 2026: "I can't drag my SG to be uploaded in RC." This was
          a hidden file input behind a label — click only — inside a dashed
          border that reads as an invitation to drop. Worse, with no drop zone
          mounted anywhere on this page, a dropped file navigated the browser
          away and took the half-filled version label and notes with it. */}
      <FileDropZone
        file={file}
        onFile={setFile}
        disabled={uploading}
        label="Drag your Supervision Guidelines here, or click to browse"
      />

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Version label (optional, e.g. 'v5')"
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          className="w-48 rounded-lg border border-rc-border px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        placeholder="What changed (optional)"
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
        {uploading ? "Uploading…" : isFirstUpload ? "Upload" : "Publish new version"}
      </button>
      {error && <p className="text-xs text-rc-amber-deep">{error}</p>}
    </form>
  );
}
