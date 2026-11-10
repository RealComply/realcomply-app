"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildSgManualPath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { startSgDocument } from "@/lib/actions/sg-document";

// Upload the office's own document, Word or PDF (Adam's mockup, 6 Nov 2026,
// screen 1). RealComply reads it into sections; nothing is saved as the live
// document until it's been checked.
export function SgDocumentUploader({ agencyId, hasLive }: { agencyId: string; hasLive: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choose(f: File | null) {
    setError(null);
    if (f && /\.doc$/i.test(f.name)) {
      setFile(null);
      setError("Old Word files (.doc) can't be read. Save it as a Word document (.docx) or a PDF, then upload it again.");
      return;
    }
    if (f && !/\.(pdf|docx)$/i.test(f.name)) {
      setFile(null);
      setError("Upload a Word (.docx) or PDF file.");
      return;
    }
    setFile(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setBusy(true);
    const path = buildSgManualPath(agencyId, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(createBrowserClient(), { path, file });
    if (uploadError) {
      setBusy(false);
      setError(uploadError);
      return;
    }
    const started = await startSgDocument(path, stored.name);
    setBusy(false);
    if (started.error) {
      setError(started.error);
      return;
    }
    setFile(null);
    router.refresh();
  }

  return (
    <form id="sg-upload" onSubmit={submit} className="rounded-card border border-rc-border bg-white p-5 shadow-card">
      <h2 className="text-base font-semibold text-rc-ink">{hasLive ? "Upload a new version" : "Upload your document"}</h2>
      <p className="mt-1 max-w-prose text-sm text-rc-muted">
        Upload your office&rsquo;s own document, Word or PDF. RealComply reads it and splits it into sections, so nothing
        needs retyping. You check it before it&rsquo;s saved{hasLive ? ", and the current one stays until you do" : ""}.
      </p>
      <div className="mt-3">
        <FileDropZone file={file} onFile={choose} disabled={busy} label="Drag your document here, or click to browse" />
        <p className="mt-1 text-xs text-rc-muted">Accepted files: Word (.docx) or PDF.</p>
      </div>
      <button
        type="submit"
        disabled={busy || !file}
        className="mt-3 rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        {busy ? "Uploading…" : "Upload and read"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rc-amber-deep">
          {error}
        </p>
      )}
    </form>
  );
}
