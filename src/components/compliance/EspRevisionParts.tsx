"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertTriangle, Paperclip, Sparkles, Info } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { AcceptedFilesLine, CantReadNotice } from "@/components/AcceptedFiles";
import { unreadableKind } from "@/lib/storage/accepted-files";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildEvidencePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { cancelEspDraft, readEspNotice, recordEspRevision, type EspActionState } from "@/lib/actions/esp-revisions";
import {
  ADD_REVISION,
  UPLOAD_HELP,
  replaceWarning,
  type EspVersion,
  type PendingRevision,
} from "@/lib/esp-history";

// The parts of the ESP revision card (Adam, 3 Nov 2026; the approved mockup;
// 0110): every version, newest first; the notice upload; and the draft, read
// from the notice, that the agent checks and saves as a new revision. Nothing
// on this card is ever written over.

/** What the server worked out for the card (app/dashboard/[id]/page.tsx). */
export type EspHistoryView = {
  versions: EspVersion[];
  /** Signed links to each notice and the agency agreement, by storage path. */
  fileUrls: Record<string, string>;
  /** The latest revision's number, or null before the first. */
  latestNo: number | null;
};

/** The versions, newest first (mockup view 1). */
export function EspHistoryList({ view }: { view: EspHistoryView }) {
  return (
    <ul className="overflow-hidden rounded-xl border border-rc-border">
      {view.versions.map((v, i) => (
        <li
          key={v.key}
          className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3.5 py-3 ${i > 0 ? "border-t border-rc-border" : ""} ${
            v.latest ? "bg-rc-green-soft" : "bg-white"
          }`}
        >
          <span className="text-sm font-bold text-rc-ink">{v.label}</span>
          <span
            className={`h-fit whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
              v.latest ? "bg-white text-rc-green-deep" : "border border-rc-border bg-rc-bg-alt text-rc-muted"
            }`}
          >
            {v.pill}
          </span>
          <span
            className={`col-span-2 text-base font-bold tabular-nums ${v.latest ? "text-rc-ink" : "text-rc-muted line-through decoration-1"}`}
          >
            {v.range}
          </span>
          <span className="col-span-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-rc-muted">
            {v.lines.map((l) => (
              <span key={l}>{l}</span>
            ))}
            {v.file &&
              (view.fileUrls[v.file.path] ? (
                <a
                  href={view.fileUrls[v.file.path]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-rc-green-deep hover:underline"
                >
                  <Paperclip size={12} aria-hidden="true" /> {v.file.name}
                </a>
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-rc-green-deep">
                  <Paperclip size={12} aria-hidden="true" /> {v.file.name}
                </span>
              ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Upload the notice: it goes up, then RealComply reads the figures from it into the draft. */
export function EspNoticeUpload({
  propertyId,
  title,
  onCancel,
}: {
  propertyId: string;
  /** "Add new estimated selling price revision" once there is one; none for the first. */
  title: string | null;
  onCancel?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"uploading" | "reading" | null>(null);

  async function upload() {
    if (!file) {
      setError("Choose the notice, or drag it onto the box above.");
      return;
    }
    setError(null);
    setBusy("uploading");
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle()
      : { data: null };
    if (!profile?.agency_id) {
      setBusy(null);
      setError("Couldn't confirm your agency. Reload the page and try again.");
      return;
    }
    const path = buildEvidencePath(profile.agency_id, propertyId, "d3", file.name);
    // An iPhone photo goes up as a JPEG (uploadEvidenceObject): the name kept is the file that exists.
    const { error: uploadError, file: stored } = await uploadEvidenceObject(supabase, { path, file });
    if (uploadError) {
      setBusy(null);
      setError(uploadError);
      return;
    }
    setBusy("reading");
    const result = await readEspNotice(propertyId, path, stored.name);
    setBusy(null);
    if (result.error) setError(result.error);
  }

  return (
    <div className="space-y-2 rounded-xl border border-rc-border bg-white p-3.5">
      {title && <p className="text-sm font-bold text-rc-ink">{title}</p>}
      <p className="text-xs leading-relaxed text-rc-muted">{UPLOAD_HELP}</p>
      <FileDropZone compact file={file} onFile={setFile} disabled={busy !== null} label="Drag the notice here, or click to browse" />
      <AcceptedFilesLine />
      {error && (
        <p role="alert" className="text-xs font-medium text-rc-amber-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={upload}
          disabled={busy !== null}
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy === "uploading" ? "Uploading…" : busy === "reading" ? "Reading the notice…" : "Upload and read"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy !== null}
            className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

const asTyped = (n: number | null) => (n == null ? "" : n.toLocaleString("en-AU"));
const typed = (raw: string) => {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The draft (mockup view 2): the figures read from the notice, which the agent
 * checks against it, the date it was given, the two confirmations, and what
 * saving does. Save revision records it; Cancel drops the draft and nothing
 * else changes.
 *
 * A notice in a Word file or a saved email can't be read (Adam, 3 Nov 2026):
 * the draft says so in his words, in place of "The notice couldn't be read.
 * Type the figures from it, or upload a clearer copy.", and keeps the figures
 * to type. Its "Upload a PDF" cancels the draft, as Cancel does, so the upload
 * box comes back for the PDF.
 */
export function EspDraftForm({
  propertyId,
  pending,
  latestNo,
  fileUrl,
  onUploadPdf,
}: {
  propertyId: string;
  pending: PendingRevision;
  latestNo: number | null;
  fileUrl: string | null;
  /** After "Upload a PDF" has cancelled the draft: brings the upload box back. */
  onUploadPdf?: () => void;
}) {
  const [state, action, saving] = useActionState<EspActionState, FormData>(recordEspRevision.bind(null, propertyId), { error: null });
  const [cancelling, startCancel] = useTransition();
  const [low, setLow] = useState(asTyped(pending.low));
  const [high, setHigh] = useState(asTyped(pending.high));
  const lowN = typed(low);
  const highN = typed(high);
  const spread = lowN && highN && highN >= lowN ? ((highN - lowN) / lowN) * 100 : null;
  const cancel = () => startCancel(async () => void (await cancelEspDraft(propertyId)));
  const cantRead = !pending.notRecognised && unreadableKind(pending.fileName) !== null;
  const uploadPdf = () =>
    startCancel(async () => {
      const { error } = await cancelEspDraft(propertyId);
      if (!error) onUploadPdf?.();
    });

  return (
    <form action={action} className="space-y-3 rounded-xl border border-rc-border bg-white p-3.5">
      <p className="text-sm font-bold text-rc-ink">{latestNo ? ADD_REVISION : "Record the revision"}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-rc-muted">
        <Paperclip size={12} aria-hidden="true" />
        {fileUrl ? (
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-rc-green-deep hover:underline">
            {pending.fileName}
          </a>
        ) : (
          <span className="font-semibold text-rc-ink">{pending.fileName}</span>
        )}
      </p>

      {pending.notRecognised ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-2 text-xs text-rc-amber-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            That doesn&rsquo;t look like a notice revising the estimated selling price. Cancel, then upload the notice you
            gave the seller.
          </span>
        </p>
      ) : cantRead ? (
        <CantReadNotice fileName={pending.fileName} onUploadPdf={uploadPdf} disabled={saving || cancelling} />
      ) : pending.readFailed ? (
        <p className="flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-2 text-xs text-rc-amber-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {pending.readFailed} What you type is recorded as typed from the notice.
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-1.5 rounded-lg bg-rc-green-soft px-2.5 py-2 text-xs text-rc-green-deep">
          <Sparkles size={13} className="mt-0.5 shrink-0" />
          <span>Read from the notice. Check these against it before you save.</span>
        </p>
      )}

      {!pending.notRecognised && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label className="text-xs font-semibold text-rc-ink">
              New ESP from
              <input
                name="revisedEspLow"
                inputMode="numeric"
                value={low}
                onChange={(e) => setLow(e.target.value)}
                placeholder="1,250,000"
                className="mt-1 w-full rounded-md border border-rc-border px-2.5 py-2 text-sm tabular-nums focus:border-rc-green-deep focus:outline-none"
              />
            </label>
            <label className="text-xs font-semibold text-rc-ink">
              New ESP to
              <input
                name="revisedEspHigh"
                inputMode="numeric"
                value={high}
                onChange={(e) => setHigh(e.target.value)}
                placeholder="1,300,000"
                className="mt-1 w-full rounded-md border border-rc-border px-2.5 py-2 text-sm tabular-nums focus:border-rc-green-deep focus:outline-none"
              />
            </label>
          </div>
          {spread !== null && spread > 10 && (
            <p className="text-[11px] leading-relaxed text-rc-amber-deep">
              Spread {spread.toFixed(1)}%: wider than the 10% s72A(2) allows, which is a problem with the notice itself,
              not with this record.
            </p>
          )}
          <label className="block text-xs font-semibold text-rc-ink">
            Date the notice was given
            <input
              name="noticeGivenOn"
              type="date"
              defaultValue={pending.givenOn ?? ""}
              className="mt-1 block rounded-md border border-rc-border px-2.5 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
            />
          </label>

          {/* The two things the notice can't prove about itself: one before it
              (s72A(5)), one after it (s73(3)). */}
          <div className="divide-y divide-rc-border rounded-md border border-rc-border">
            <label className="flex items-start gap-2.5 px-3 py-2.5">
              <input
                type="checkbox"
                name="evidenceProvidedBeforeNotice"
                value="yes"
                defaultChecked={pending.evidenceProvidedBeforeNotice ?? false}
                className="mt-0.5 shrink-0 accent-rc-green-deep"
              />
              <span>
                <span className="block text-sm text-rc-ink">Vendor was given evidence of the new price before the notice</span>
                <span className="block text-[11px] text-rc-faint">
                  s72A(5).{" "}
                  {pending.evidenceProvidedBeforeNotice
                    ? "The notice says so, so this is ticked. Untick it if that is wrong."
                    : "Comparable sales, market conditions, buyer feedback."}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 px-3 py-2.5">
              <input type="checkbox" name="advertisingUpdated" value="yes" className="mt-0.5 shrink-0 accent-rc-green-deep" />
              <span>
                <span className="block text-sm text-rc-ink">Advertising updated to match the revised price</span>
                <span className="block text-[11px] text-rc-faint">
                  s73(3). Anything showing a lower figure has to be amended or pulled as soon as practicable.
                </span>
              </span>
            </label>
          </div>

          <p className="flex items-start gap-1.5 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-3 py-2.5 text-xs leading-relaxed text-rc-ink">
            <Info size={13} className="mt-0.5 shrink-0 text-rc-amber-deep" />
            <span>{replaceWarning(latestNo)}</span>
          </p>
        </>
      )}

      {state.error && (
        <p role="alert" className="text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!pending.notRecognised && (
          <button
            type="submit"
            disabled={saving || cancelling}
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save revision"}
          </button>
        )}
        <button
          type="button"
          onClick={cancel}
          disabled={saving || cancelling}
          className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt disabled:opacity-60"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </form>
  );
}
