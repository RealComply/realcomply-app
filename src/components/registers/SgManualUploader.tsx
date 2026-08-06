"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { uploadEvidenceObject, buildSgManualPath } from "@/lib/storage/evidence";
import { addSgManualVersion } from "@/lib/actions/registers";
import type { Profile } from "@/lib/types";

export function SgManualUploader({ profile }: { profile: Profile }) {
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
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-dashed border-rc-border p-4">
      <h3 className="text-sm font-semibold text-rc-ink">Publish a new version</h3>
      <input type="file" onChange={handleFile} className="block text-sm" />
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Version label (optional, e.g. 'v5')"
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          className="w-48 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
      </div>
      <textarea
        placeholder="What changed (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={uploading}
        className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {uploading ? "Uploading…" : "Publish"}
      </button>
      {error && <p className="text-xs text-rc-amber-deep">{error}</p>}
    </form>
  );
}
