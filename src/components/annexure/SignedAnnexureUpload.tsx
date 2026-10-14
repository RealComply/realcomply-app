"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, MAX_EVIDENCE_BYTES, sanitizeFileName } from "@/lib/storage/evidence";
import { UPLOAD_LABEL, signedAnnexureProblem, signedAnnexureType } from "@/lib/agent-acknowledgement";
import { recordSignedAnnexure } from "@/lib/actions/agent-acknowledgement";

// "Upload the signed annexure" (job 7 brief, Part 3): the annexure the
// agent's licensee in charge signed, as a PDF, JPG or PNG within the usual
// size limit. Straight from the browser into the office's _signoffs folder,
// as every other upload goes (Vercel caps a request at 4.5 MB), then filed
// in Document sign-offs by recordSignedAnnexure. The database checks it again
// and refuses anything else (0071).

const STYLES = {
  primary:
    "inline-flex items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60",
  ghost:
    "inline-flex items-center justify-center rounded-full border-2 border-rc-green-deep px-5 py-2 text-sm font-bold text-rc-green-deep transition hover:bg-rc-green-soft disabled:opacity-60",
} as const;

export function SignedAnnexureUpload({
  agencyId,
  variant = "ghost",
}: {
  agencyId: string;
  variant?: keyof typeof STYLES;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const problem = signedAnnexureProblem(file, MAX_EVIDENCE_BYTES);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const path = `${agencyId}/_signoffs/licensee-signed/${Date.now()}-${sanitizeFileName(file.name)}`;
      const { error: uploadError } = await createBrowserClient()
        .storage.from(EVIDENCE_BUCKET)
        .upload(path, file, { contentType: signedAnnexureType(file) ?? undefined });
      if (uploadError) {
        setError("The upload didn’t go through. Check your connection and try again.");
        return;
      }
      const result = await recordSignedAnnexure(path, file.name);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="min-w-0">
      <input
        ref={input}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        className="sr-only"
        aria-label={UPLOAD_LABEL}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={STYLES[variant]}>
        {busy ? "Uploading…" : UPLOAD_LABEL}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-rc-red">
          {error}
        </p>
      )}
    </div>
  );
}
