"use client";

import { useState } from "react";
import { AlertTriangle, Paperclip } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildComplaintFilePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { addComplaintFile, removeComplaintFile } from "@/lib/actions/complaint-files";
import { addedLine, fileSizeLabel, removedLine } from "@/lib/complaint-files";
import type { ComplaintFile } from "@/lib/types";

// The files on one complaint, inside its entry on the Complaints register
// (0101; the REVERSAL of 16 Oct 2026 is in lib/complaint-files.ts). The
// licensee in charge's only, like the register.
//
// One file at a time, chosen then attached, as everywhere else (FileDropZone
// on why the two steps stay apart). Same types, 150 MB limit and empty or
// damaged file checks as every other upload. Removing asks first, and the
// removal stays listed with who and when.
export function ComplaintFiles({
  agencyId,
  complaintId,
  current,
  removed,
  urlByPath,
  nameOf,
}: {
  agencyId: string;
  complaintId: string;
  current: ComplaintFile[];
  removed: ComplaintFile[];
  /** Short-lived links to open each file, made on the server with the licensee's own access. */
  urlByPath: Record<string, string>;
  nameOf: Record<string, string>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function attach() {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setAttaching(true);
    const path = buildComplaintFilePath(agencyId, complaintId, file.name);
    const { error: uploadError, file: stored } = await uploadEvidenceObject(createBrowserClient(), { path, file });
    if (uploadError) {
      setAttaching(false);
      setError(uploadError);
      return;
    }
    // stored.name, not file.name: a HEIC photo has become a JPEG by now.
    const { error: saveError } = await addComplaintFile(complaintId, path, stored.name);
    setAttaching(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setFile(null);
  }

  async function remove(id: string) {
    setError(null);
    setRemoving(id);
    const { error: removeError } = await removeComplaintFile(id);
    setRemoving(null);
    setConfirming(null);
    if (removeError) setError(removeError);
  }

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Files</h4>
        {current.length === 0 ? (
          <p className="mt-1 text-sm text-rc-muted">No files on this complaint yet.</p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {current.map((f) => {
              const url = urlByPath[f.file_path];
              const size = fileSizeLabel(f.size_bytes);
              return (
                <li key={f.id} className="rounded-lg border border-rc-border bg-white px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 items-start gap-2">
                      <Paperclip size={14} className="mt-0.5 shrink-0 text-rc-green-deep" />
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-rc-ink">{f.file_name}</p>
                        <p className="text-[11px] text-rc-faint">
                          {size ? `${size} · ` : ""}
                          {addedLine(f, nameOf)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-3 text-xs">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-rc-green-deep hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-rc-faint">Can&apos;t open just now</span>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirming(f.id)}
                        disabled={removing !== null}
                        className="text-rc-faint transition hover:text-rc-amber-deep disabled:opacity-60"
                      >
                        {removing === f.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                  {confirming === f.id && (
                    <div role="alertdialog" className="mt-2 rounded-lg border border-rc-border bg-neutral-50 px-3 py-2 text-sm">
                      <p className="text-rc-ink">
                        Remove {f.file_name} from this complaint? The file is deleted, and the register keeps a record
                        of who removed it and when.
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => remove(f.id)}
                          disabled={removing !== null}
                          className="rounded-full bg-rc-amber-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="rounded-full border border-rc-border px-4 py-1.5 text-xs font-medium text-rc-muted hover:bg-neutral-100"
                        >
                          Keep it
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {removed.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Removed</h4>
          <ul className="mt-1 space-y-1">
            {removed.map((f) => (
              <li key={f.id} className="text-xs text-rc-muted">
                <span className="break-words line-through decoration-rc-faint">{f.file_name}</span>{" "}
                <span className="text-rc-faint">· {removedLine(f, nameOf)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Add a file</h4>
        <p className="mt-0.5 text-[11px] text-rc-muted">
          The complaint email, a letter, a photo, the outcome letter. One at a time: PDF, photo, Word, Excel or saved
          email, up to 150 MB.
        </p>
        <div className="mt-1.5 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 basis-60">
            <FileDropZone
              compact
              file={file}
              onFile={(f) => {
                setError(null);
                setFile(f);
              }}
              disabled={attaching}
              label="Drag a file here, or click to browse"
            />
          </div>
          <button
            type="button"
            onClick={attach}
            disabled={!file || attaching}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {attaching ? "Attaching…" : "Attach file"}
          </button>
        </div>
        {file && !attaching && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rc-amber-deep">
            <AlertTriangle size={12} className="shrink-0" />
            Not attached yet. Press Attach file to save it.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-rc-amber-deep">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
