"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildEvidencePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { putBackOnMarket, withdrawListing, type WithdrawalState } from "@/lib/actions/withdrawals";
import {
  PUT_BACK_HINT,
  WITHDRAW_EXPLAINER,
  WITHDRAW_REASONS,
  WITHDRAW_WARNING,
} from "@/lib/rules/listing-tabs";

// Withdraw from market, and the banner on a withdrawn listing (Job B, mockup
// v6; 0114). The evidence is stored, not read, so there is no "Accepted files"
// line (Master's brief: only where the file is read).

const initial: WithdrawalState = { error: null };

/** "Withdraw from market", then the form, on a listing that hasn't exchanged. */
export function WithdrawFromMarket({
  propertyId,
  agencyId,
  today,
}: {
  propertyId: string;
  agencyId: string;
  /** Today in Sydney, YYYY-MM-DD: the default date and the latest allowed. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(withdrawListing.bind(null, propertyId), initial);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-rc-green-deep underline-offset-2 hover:underline"
      >
        Withdraw from market
      </button>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(null);
    const form = new FormData(event.currentTarget);
    form.delete("evidence");
    if (file) {
      setUploading(true);
      const path = buildEvidencePath(agencyId, propertyId, "withdrawal", file.name);
      const { error, file: stored } = await uploadEvidenceObject(createBrowserClient(), { path, file });
      setUploading(false);
      if (error) {
        setUploadError(error);
        return;
      }
      form.set("evidencePath", path);
      form.set("evidenceFileName", stored.name);
    }
    startTransition(() => formAction(form));
  }

  const busy = uploading || pending;
  return (
    <form
      onSubmit={submit}
      className="mt-3 grid max-w-2xl gap-3 rounded-card border border-rc-border bg-white p-4 shadow-card"
    >
      <h3 className="text-base font-semibold text-rc-ink">Withdraw from market</h3>
      <p className="text-sm text-rc-muted">{WITHDRAW_EXPLAINER}</p>
      <div>
        <label htmlFor="withdrawn-on" className="block text-sm font-medium text-rc-ink">
          Date withdrawn
        </label>
        <input
          id="withdrawn-on"
          type="date"
          name="withdrawnOn"
          required
          defaultValue={today}
          max={today}
          className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label htmlFor="withdraw-reason" className="block text-sm font-medium text-rc-ink">
          Reason
        </label>
        <select
          id="withdraw-reason"
          name="reason"
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        >
          <option value="" disabled>
            Choose one
          </option>
          {WITHDRAW_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {reason === "other" && (
          <div className="mt-2">
            <label htmlFor="withdraw-other" className="block text-sm font-medium text-rc-ink">
              Say why
            </label>
            <input
              id="withdraw-other"
              type="text"
              name="reasonOther"
              required
              maxLength={500}
              className="mt-1 w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
          </div>
        )}
      </div>
      <div>
        <label htmlFor="withdraw-evidence" className="block text-sm font-medium text-rc-ink">
          Evidence <span className="font-normal text-rc-muted">(optional)</span>
        </label>
        <p className="text-xs text-rc-muted">The seller&rsquo;s email or the termination notice</p>
        <input
          id="withdraw-evidence"
          type="file"
          name="evidence"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block text-sm"
        />
      </div>
      <p className="rounded-lg border border-rc-amber/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-ink">
        <span className="font-semibold text-rc-amber-deep">When you withdraw it:</span> {WITHDRAW_WARNING}
      </p>
      {(uploadError || state.error) && <p className="text-sm text-rc-amber-deep">{uploadError ?? state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {uploading ? "Uploading…" : pending ? "Withdrawing…" : "Withdraw listing"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-medium text-rc-muted transition hover:bg-rc-bg-alt"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The banner on a withdrawn listing, with "Put back on the market". */
export function WithdrawnBanner({
  propertyId,
  line,
  evidence,
  history,
  canPutBack,
}: {
  propertyId: string;
  /** "Withdrawn on 21 October 2026 by Marcus Tran. Reason: Seller changed their mind." */
  line: string;
  evidence: { path: string; fileName: string } | null;
  /** Earlier withdrawals and put-backs, oldest first, one line each. */
  history: string[];
  canPutBack: boolean;
}) {
  const [state, formAction, pending] = useActionState(() => putBackOnMarket(propertyId), initial);
  return (
    <div className="mt-6 grid gap-3 rounded-card border border-rc-border bg-neutral-100 px-4 py-3 text-sm text-rc-ink">
      <p>
        <span className="font-semibold">{line}</span>
        {evidence && (
          <>
            {" "}
            Evidence: <StoredFileLink path={evidence.path} fileName={evidence.fileName} />
          </>
        )}
      </p>
      {history.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-rc-muted">
          {history.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {canPutBack && (
        <form action={formAction} className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:bg-rc-bg-alt disabled:opacity-60"
          >
            {pending ? "Putting back…" : "Put back on the market"}
          </button>
          <span className="text-xs text-rc-muted">{PUT_BACK_HINT}</span>
        </form>
      )}
      {state.error && <p className="text-sm text-rc-amber-deep">{state.error}</p>}
    </div>
  );
}

function StoredFileLink({ path, fileName }: { path: string; fileName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    createBrowserClient()
      .storage.from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-rc-green-deep hover:underline">
      <Paperclip size={13} aria-hidden="true" /> {fileName}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1 text-rc-faint">
      <Paperclip size={13} aria-hidden="true" /> {fileName}
    </span>
  );
}
