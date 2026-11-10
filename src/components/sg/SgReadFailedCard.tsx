"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { discardSgDocument, fileSgDocumentUnread, retrySgDocument } from "@/lib/actions/sg-document";
import { fileUnreadSaid } from "@/lib/sg-document/file-unread";

// A document that couldn't be read: why, in plain words, and what can be
// done. Nothing has changed until one of these is pressed: the current file
// stays as it is. "File it without reading it" keeps what the office could
// always do: the file as its current SG Manual, without sections. A new
// upload is then signed by every staff member; a manual already on file
// isn't signed again (Master, 10 Nov 2026).
export function SgReadFailedCard({
  id,
  fileName,
  reason,
  fromFileOnRecord = false,
}: {
  id: string;
  fileName: string;
  reason: string | null;
  fromFileOnRecord?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"retry" | "discard" | "file" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "retry" | "discard" | "file") {
    setBusy(kind);
    setError(null);
    const r = kind === "retry" ? await retrySgDocument(id) : kind === "file" ? await fileSgDocumentUnread(id) : await discardSgDocument(id);
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  return (
    <section className="rounded-card border border-rc-amber-deep/25 bg-rc-amber/10 p-5">
      <h2 className="text-base font-semibold text-rc-amber-deep">
        {fromFileOnRecord ? <>Your manual on file couldn&rsquo;t be read into sections</> : <>Your document couldn&rsquo;t be read</>}
      </h2>
      <p className="mt-1 text-sm text-rc-ink">
        <span className="font-medium">{fileName}</span>: {reason ?? "It couldn't be read just now. Try reading it again in a minute."}
      </p>
      <p className="mt-1 text-xs text-rc-muted">Nothing has changed: your current file stays as it is.</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => act("retry")}
          disabled={busy !== null}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {busy === "retry" ? "Starting…" : "Read it again"}
        </button>
        <button type="button" onClick={() => act("file")} disabled={busy !== null} className="text-sm font-medium text-rc-green-deep hover:underline">
          {busy === "file" ? "Filing…" : "File it without reading it"}
        </button>
        <button type="button" onClick={() => act("discard")} disabled={busy !== null} className="text-sm font-medium text-rc-muted hover:text-rc-amber-deep">
          {busy === "discard" ? "Throwing away…" : "Throw it away"}
        </button>
      </div>
      <p className="mt-2 text-xs text-rc-muted">{fileUnreadSaid(fromFileOnRecord)}</p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rc-amber-deep">
          {error}
        </p>
      )}
    </section>
  );
}
