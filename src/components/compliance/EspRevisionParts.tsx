"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertTriangle, Check, Paperclip, Sparkles, Info, Star, Trash2 } from "lucide-react";
import { RevisionComparablesFields } from "@/components/compliance/RevisionComparables";
import { REVISION_COMPARABLES_LABEL, saleLine, type RevisionCandidate } from "@/lib/rules/revision-comparables";
import { factorsLine } from "@/lib/rules/comparables-rules";
import type { AreaKind } from "@/lib/rules/council-area";
import { FileDropZone } from "@/components/FileDropZone";
import { AcceptedFilesLine, CantReadNotice, WordFileNotice } from "@/components/AcceptedFiles";
import { unreadableKind } from "@/lib/storage/accepted-files";
import { advertisingFixLine } from "@/lib/rules/underquoting-reforms";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildEvidencePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { cancelEspDraft, deleteEspRevision, readEspNotice, recordEspRevision, type EspActionState } from "@/lib/actions/esp-revisions";
import {
  ADD_REVISION,
  DELETE_REVISION,
  deleteButton,
  EVIDENCE_HINT,
  EVIDENCE_IN_NOTICE_LABEL,
  EVIDENCE_LABEL,
  PREVIOUS_ESP_HINT,
  PREVIOUS_ESP_LABEL,
  UPLOAD_HELP,
  espRange,
  noticeUnderReforms,
  previousEspDiffers,
  replaceWarning,
  type EspVersion,
  type PendingRevision,
} from "@/lib/esp-history";
import {
  FEEDBACK_ELSEWHERE_CONFIRM,
  FEEDBACK_ELSEWHERE_HINT,
  FEEDBACK_ELSEWHERE_LABEL,
  FEEDBACK_ELSEWHERE_PLACEHOLDER,
  FEEDBACK_FILE_HINT,
  FEEDBACK_FILE_LABEL,
  FEEDBACK_HINT,
  FEEDBACK_LABELS,
  FEEDBACK_TICK,
  feedbackFrom,
} from "@/lib/rules/market-feedback";

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
  /** The ESP on file now: the one a new revision's notice should give as the ESP before it (0117). */
  currentEsp?: { low: number | null; high: number | null };
  /** For the next revision's comparable sales (Reg s12G; 0120): the sales to choose from, and the previous ESP's. */
  revisionComparables?: { candidates: RevisionCandidate[]; previousAddresses: string[] };
  /** Metro or not (Reg s12A; 0118), for where each sale sits against the search area. */
  areaKind?: AreaKind | null;
  /**
   * Delete a revision (Adam, 10 Nov 2026; 0124): for the listing's agent or
   * the licensee in charge, and not on a signed-off file or a withdrawn
   * listing (page.tsx). Null for everyone else.
   */
  deleting?: { propertyId: string } | null;
};

/** A file on the card: a link (an hour) when there is one, else its name. */
function FileLink({ url, name }: { url: string | undefined; name: string }) {
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-semibold text-rc-green-deep hover:underline"
    >
      <Paperclip size={12} aria-hidden="true" /> {name}
    </a>
  ) : (
    <span className="inline-flex items-center gap-1 font-semibold text-rc-green-deep">
      <Paperclip size={12} aria-hidden="true" /> {name}
    </span>
  );
}

/**
 * Puts a file in the listing's d3 folder, as the notice goes (0110). The
 * stored name is the file that exists: an iPhone photo goes up as a JPEG.
 */
async function uploadToD3(propertyId: string, file: File): Promise<{ error: string } | { path: string; name: string }> {
  const supabase = createBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle()
    : { data: null };
  if (!profile?.agency_id) return { error: "Couldn't confirm your agency. Reload the page and try again." };
  const path = buildEvidencePath(profile.agency_id, propertyId, "d3", file.name);
  const { error, file: stored } = await uploadEvidenceObject(supabase, { path, file });
  return error ? { error } : { path, name: stored.name };
}

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
            {v.file && <FileLink url={view.fileUrls[v.file.path]} name={v.file.name} />}
            {v.evidence && <FileLink url={view.fileUrls[v.evidence.path]} name={`Evidence: ${v.evidence.name}`} />}
          </span>
          {/* The market feedback it responded to (Reg s12G(1)(f)). */}
          {((v.feedback?.length ?? 0) > 0 || v.feedbackRecord?.file || v.feedbackRecord?.where) && (
            <div className="col-span-2 mt-1 space-y-2 rounded-lg border border-rc-border bg-white px-2.5 py-2 text-xs">
              <p className="font-semibold text-rc-ink">Market feedback it responded to</p>
              {v.feedbackRecord?.file && (
                <p>
                  <FileLink url={view.fileUrls[v.feedbackRecord.file.path]} name={`Record: ${v.feedbackRecord.file.name}`} />
                </p>
              )}
              {v.feedbackRecord?.where && <p className="text-rc-muted">Recorded in: {v.feedbackRecord.where}</p>}
              {v.feedbackRecord?.where && v.feedbackRecord.confirmed && (
                <p className="flex items-start gap-1.5 text-rc-muted">
                  <Check size={12} className="mt-0.5 shrink-0 text-rc-green-deep" aria-hidden="true" />
                  <span>{FEEDBACK_ELSEWHERE_CONFIRM}</span>
                </p>
              )}
              {(v.feedback ?? []).map((f, i) => (
                <div key={i} className="space-y-0.5 text-rc-muted">
                  <p className="font-semibold text-rc-ink">{feedbackFrom(f)}</p>
                  <p>{f.what}</p>
                  <p>
                    <span className="font-semibold">Why used:</span> {f.why}
                  </p>
                  <p>
                    <span className="font-semibold">How used:</span> {f.how}
                  </p>
                </div>
              ))}
            </div>
          )}
          {/* Its own comparable sales (Reg s12G(1)(a), (c), (d); 0120). */}
          {((v.comparables?.length ?? 0) > 0 || v.comparablesInfoUsed || v.comparablesFewerReason) && (
            <div className="col-span-2 mt-1 space-y-2 rounded-lg border border-rc-border bg-white px-2.5 py-2 text-xs">
              <p className="font-semibold text-rc-ink">{REVISION_COMPARABLES_LABEL}</p>
              {(v.comparables ?? []).map((c, i) => (
                <div key={i} className="space-y-0.5 text-rc-muted">
                  <p className="flex items-start gap-1.5 font-semibold text-rc-ink">
                    {c.most && <Star size={12} className="mt-0.5 shrink-0 fill-current text-rc-green-deep" aria-hidden="true" />}
                    <span>{saleLine(c)}</span>
                  </p>
                  {c.most && (
                    <p>
                      <span className="font-semibold">One of the 3 most comparable:</span> {c.mostReason}
                      {c.factors.length > 0 ? ` Comparison factors weighed: ${factorsLine(c.factors)}.` : ""}
                    </p>
                  )}
                  {c.notBeforeReason && (
                    <p>
                      <span className="font-semibold">Not used for the previous ESP because:</span> {c.notBeforeReason}
                    </p>
                  )}
                </div>
              ))}
              {v.comparablesFewerReason && (
                <p className="text-rc-muted">
                  <span className="font-semibold">Fewer than 3 comparable:</span> {v.comparablesFewerReason}
                </p>
              )}
              {v.comparablesInfoUsed && (
                <p className="text-rc-muted">
                  <span className="font-semibold">Information used:</span> {v.comparablesInfoUsed}
                </p>
              )}
            </div>
          )}
          {view.deleting && v.revisionNo !== undefined && (
            <DeleteRevision propertyId={view.deleting.propertyId} no={v.revisionNo} lines={v.deleteLines ?? []} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** On a revision: "Delete", which says what deleting it does before it goes. */
function DeleteRevision({ propertyId, no, lines }: { propertyId: string; no: number; lines: string[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="col-span-2 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-rc-red hover:underline"
        >
          <Trash2 size={12} aria-hidden="true" /> {DELETE_REVISION}
        </button>
      </div>
    );
  }

  return (
    <div className="col-span-2 mt-1 space-y-2 rounded-lg border border-rc-red/30 bg-white px-2.5 py-2 text-xs">
      {lines.map((l, k) => (
        <p key={l} className={k === 0 ? "font-semibold text-rc-ink" : "text-rc-muted"}>
          {l}
        </p>
      ))}
      {error && <p className="font-semibold text-rc-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await deleteEspRevision(propertyId, no);
              if (res.error) setError(res.error);
              else setOpen(false);
            });
          }}
          className="rounded-md bg-rc-red px-3 py-1.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Deleting…" : deleteButton(no)}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-md border border-rc-border px-3 py-1.5 font-medium text-rc-muted transition hover:bg-rc-bg-alt"
        >
          Cancel
        </button>
      </div>
    </div>
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
    const stored = await uploadToD3(propertyId, file);
    if ("error" in stored) {
      setBusy(null);
      setError(stored.error);
      return;
    }
    setBusy("reading");
    const result = await readEspNotice(propertyId, stored.path, stored.name);
    setBusy(null);
    if (result.error) setError(result.error);
  }

  return (
    <div className="space-y-2 rounded-xl border border-rc-border bg-white p-3.5">
      {title && <p className="text-sm font-bold text-rc-ink">{title}</p>}
      <p className="text-xs leading-relaxed text-rc-muted">{UPLOAD_HELP}</p>
      <FileDropZone compact file={file} onFile={setFile} disabled={busy !== null} label="Drag the notice here, or click to browse" />
      <AcceptedFilesLine word />
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

/** One piece of market feedback, as typed (Reg s12G(1)(f)). */
type FeedbackRow = { who: string; contact: string; on: string; what: string; why: string; how: string };
const BLANK_FEEDBACK: FeedbackRow = { who: "", contact: "", on: "", what: "", why: "", how: "" };
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
 *
 * With each revision (0117; Adam, 9 Nov 2026: "check the old ESP and attach
 * the evidence"): the ESP before it as the notice states it, read from the
 * notice where it can be, checked against the ESP on file; and the evidence
 * given to the seller, a file or part of the notice. From 17 November.
 */
export function EspDraftForm({
  propertyId,
  pending,
  latestNo,
  fileUrl,
  currentEsp = null,
  onUploadPdf,
  revisionComparables,
  areaKind = null,
}: {
  propertyId: string;
  pending: PendingRevision;
  latestNo: number | null;
  fileUrl: string | null;
  /** The sales to choose from for this revision, and the previous ESP's (Reg s12G; 0120). */
  revisionComparables?: { candidates: RevisionCandidate[]; previousAddresses: string[] };
  /** Metro or not (Reg s12A; 0118). */
  areaKind?: AreaKind | null;
  /** The ESP on file now, to check the notice's ESP before the revision against. */
  currentEsp?: { low: number | null; high: number | null } | null;
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
  const [givenOn, setGivenOn] = useState(pending.givenOn ?? "");
  const [prevLow, setPrevLow] = useState(asTyped(pending.previousLow ?? null));
  const [prevHigh, setPrevHigh] = useState(asTyped(pending.previousHigh ?? null));
  const stated = { low: typed(prevLow), high: typed(prevHigh) };
  const differs = previousEspDiffers(stated, currentEsp);
  const underReforms = noticeUnderReforms(givenOn || null);
  const onFile = currentEsp?.low != null && currentEsp.high != null ? espRange(currentEsp.low, currentEsp.high) : null;
  const [evidence, setEvidence] = useState<{ path: string; name: string } | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [inNotice, setInNotice] = useState(false);
  // The market feedback it responded to (Reg s12G(1)(f)): entered here, as a
  // revision can't be changed once recorded.
  const [feedbackTicked, setFeedbackTicked] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([BLANK_FEEDBACK]);
  const setRow = (i: number, key: keyof FeedbackRow, value: string) =>
    setFeedback((rows) => rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  // Or a record of it attached, or where it's kept (Adam, 9 Nov 2026).
  const [feedbackFile, setFeedbackFile] = useState<{ path: string; name: string } | null>(null);
  const [feedbackPicked, setFeedbackPicked] = useState<File | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackElsewhere, setFeedbackElsewhere] = useState(false);
  const pickFeedbackFile = async (file: File | null) => {
    setFeedbackPicked(file);
    setFeedbackError(null);
    if (!file) return;
    setFeedbackBusy(true);
    const stored = await uploadToD3(propertyId, file);
    setFeedbackBusy(false);
    setFeedbackPicked(null);
    if ("error" in stored) setFeedbackError(stored.error);
    else setFeedbackFile(stored);
  };
  const pickEvidence = async (file: File | null) => {
    setEvidenceFile(file);
    setEvidenceError(null);
    if (!file) return;
    setEvidenceBusy(true);
    const stored = await uploadToD3(propertyId, file);
    setEvidenceBusy(false);
    setEvidenceFile(null);
    if ("error" in stored) setEvidenceError(stored.error);
    else setEvidence(stored);
  };
  const cancel = () => startCancel(async () => void (await cancelEspDraft(propertyId)));
  const cantRead = !pending.notRecognised && unreadableKind(pending.fileName, { listingCard: true }) !== null;
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
        <CantReadNotice listingCard fileName={pending.fileName} onUploadPdf={uploadPdf} disabled={saving || cancelling} />
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
      {/* A revision can't be changed once recorded, so a Word notice is swapped for its PDF here, before it is. */}
      {!pending.notRecognised && !cantRead && (
        <WordFileNotice read fileName={pending.fileName} onUploadPdf={uploadPdf} disabled={saving || cancelling} />
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
              Spread {spread.toFixed(1)}%: wider than the 10% s72A allows, which is a problem with the notice itself,
              not with this record.
            </p>
          )}
          <label className="block text-xs font-semibold text-rc-ink">
            Date the notice was given
            <input
              name="noticeGivenOn"
              type="date"
              value={givenOn}
              onChange={(e) => setGivenOn(e.target.value)}
              className="mt-1 block rounded-md border border-rc-border px-2.5 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
            />
          </label>

          {/* 17 November rules (s72A(5); Reg s12G): only for a notice given
              from then, and never before midnight Sydney on 17 November 2026
              (Master, 10 Nov 2026). Before then, what the notice was read as
              saying, and any evidence already attached, are carried through. */}
          {underReforms ? (
            <>
            {/* The old ESP check (s72A; 0117): as the notice states it, against the file. */}
            <div>
              <p className="text-xs font-semibold text-rc-ink">{PREVIOUS_ESP_LABEL}</p>
              <div className="mt-1 grid gap-2.5 sm:grid-cols-2">
                <input
                  name="previousEspLow"
                  aria-label={`${PREVIOUS_ESP_LABEL}, from`}
                  inputMode="numeric"
                  value={prevLow}
                  onChange={(e) => setPrevLow(e.target.value)}
                  placeholder="From"
                  className="w-full rounded-md border border-rc-border px-2.5 py-2 text-sm tabular-nums focus:border-rc-green-deep focus:outline-none"
                />
                <input
                  name="previousEspHigh"
                  aria-label={`${PREVIOUS_ESP_LABEL}, to`}
                  inputMode="numeric"
                  value={prevHigh}
                  onChange={(e) => setPrevHigh(e.target.value)}
                  placeholder="To"
                  className="w-full rounded-md border border-rc-border px-2.5 py-2 text-sm tabular-nums focus:border-rc-green-deep focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-rc-faint">
                {onFile ? `On file: ${onFile}. ` : ""}
                {PREVIOUS_ESP_HINT}
              </p>
              {differs ? (
                <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-amber-deep">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{differs}</span>
                </p>
              ) : (
                underReforms &&
                (stated.low === null || stated.high === null) && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-amber-deep">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>
                      If the notice doesn&rsquo;t state it, you can still save. The card stays open until you add a notice
                      that does.
                    </span>
                  </p>
                )
              )}
            </div>

            {/* The market feedback it responded to (Reg s12G(1)(f); 0117). */}
            <div className="space-y-2 rounded-md border border-rc-border px-3 py-2.5">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  name="marketFeedbackTicked"
                  value="yes"
                  checked={feedbackTicked}
                  onChange={(e) => setFeedbackTicked(e.target.checked)}
                  className="mt-0.5 shrink-0 accent-rc-green-deep"
                />
                <span>
                  <span className="block text-sm text-rc-ink">{FEEDBACK_TICK}</span>
                  <span className="block text-[11px] text-rc-faint">{FEEDBACK_HINT}</span>
                </span>
              </label>
              <input type="hidden" name="marketFeedback" value={JSON.stringify(feedbackTicked ? feedback : [])} />
              {feedbackTicked && (
                <>
                  {feedback.map((f, i) => (
                    <div key={i} className="space-y-2 rounded-md bg-rc-bg-alt p-2.5">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="text-xs font-semibold text-rc-ink">
                          {FEEDBACK_LABELS.who}
                          <input
                            value={f.who}
                            onChange={(e) => setRow(i, "who", e.target.value)}
                            className="mt-1 w-full rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-sm font-normal focus:border-rc-green-deep focus:outline-none"
                          />
                        </label>
                        <label className="text-xs font-semibold text-rc-ink">
                          {FEEDBACK_LABELS.contact}
                          <input
                            value={f.contact}
                            onChange={(e) => setRow(i, "contact", e.target.value)}
                            className="mt-1 w-full rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-sm font-normal focus:border-rc-green-deep focus:outline-none"
                          />
                        </label>
                        <label className="text-xs font-semibold text-rc-ink">
                          {FEEDBACK_LABELS.on}
                          <input
                            type="date"
                            value={f.on}
                            onChange={(e) => setRow(i, "on", e.target.value)}
                            className="mt-1 w-full rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-sm font-normal focus:border-rc-green-deep focus:outline-none"
                          />
                        </label>
                      </div>
                      {(["what", "why", "how"] as const).map((key) => (
                        <label key={key} className="block text-xs font-semibold text-rc-ink">
                          {FEEDBACK_LABELS[key]}
                          <textarea
                            rows={2}
                            value={f[key]}
                            onChange={(e) => setRow(i, key, e.target.value)}
                            className="mt-1 w-full rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-sm font-normal focus:border-rc-green-deep focus:outline-none"
                          />
                        </label>
                      ))}
                      {feedback.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setFeedback((rows) => rows.filter((_, j) => j !== i))}
                          className="text-xs text-rc-muted hover:text-rc-ink hover:underline"
                        >
                          Remove this feedback
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setFeedback((rows) => [...rows, BLANK_FEEDBACK])}
                    className="text-xs font-semibold text-rc-green-deep hover:underline"
                  >
                    + Add more feedback
                  </button>

                  {/* Or a record of it attached, or where it's kept (Adam, 9 Nov 2026). */}
                  <div className="space-y-2 border-t border-rc-border pt-2.5">
                    <div>
                      <p className="text-xs font-semibold text-rc-ink">{FEEDBACK_FILE_LABEL}</p>
                      <p className="text-[11px] text-rc-faint">{FEEDBACK_FILE_HINT}</p>
                    </div>
                    <input type="hidden" name="feedbackFilePath" value={feedbackFile?.path ?? ""} />
                    <input type="hidden" name="feedbackFileName" value={feedbackFile?.name ?? ""} />
                    {feedbackFile ? (
                      <p className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1 font-semibold text-rc-ink">
                          <Paperclip size={12} aria-hidden="true" /> {feedbackFile.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => setFeedbackFile(null)}
                          disabled={saving}
                          className="text-rc-green-deep hover:underline disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </p>
                    ) : (
                      <FileDropZone
                        compact
                        file={feedbackPicked}
                        onFile={pickFeedbackFile}
                        disabled={feedbackBusy || saving}
                        label={feedbackBusy ? "Uploading…" : "Drag the record here, or click to browse"}
                      />
                    )}
                    {feedbackError && (
                      <p role="alert" className="text-xs font-medium text-rc-amber-deep">
                        {feedbackError}
                      </p>
                    )}
                    <label className="flex items-start gap-2.5 pt-1">
                      <input
                        type="checkbox"
                        name="feedbackElsewhere"
                        value="yes"
                        checked={feedbackElsewhere}
                        onChange={(e) => setFeedbackElsewhere(e.target.checked)}
                        className="mt-0.5 shrink-0 accent-rc-green-deep"
                      />
                      <span>
                        <span className="block text-sm text-rc-ink">{FEEDBACK_ELSEWHERE_LABEL}</span>
                        <span className="block text-[11px] text-rc-faint">{FEEDBACK_ELSEWHERE_HINT}</span>
                      </span>
                    </label>
                    {feedbackElsewhere && (
                      <>
                        <input
                          name="feedbackWhere"
                          aria-label="Where the market feedback is recorded"
                          placeholder={FEEDBACK_ELSEWHERE_PLACEHOLDER}
                          className="w-full rounded-md border border-rc-border bg-white px-2.5 py-1.5 text-sm focus:border-rc-green-deep focus:outline-none"
                        />
                        {/* Required with it (Adam, 9 Nov 2026). */}
                        <label className="flex items-start gap-2.5">
                          <input
                            type="checkbox"
                            name="feedbackElsewhereConfirmed"
                            value="yes"
                            className="mt-0.5 shrink-0 accent-rc-green-deep"
                          />
                          <span className="text-sm text-rc-ink">{FEEDBACK_ELSEWHERE_CONFIRM}</span>
                        </label>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Its own comparable sales (Reg s12G(1)(a), (c), (d); 0120). */}
            <RevisionComparablesFields
              candidates={revisionComparables?.candidates ?? []}
              previousAddresses={revisionComparables?.previousAddresses ?? []}
              kind={areaKind}
              givenOn={givenOn}
              underReforms={underReforms}
            />

            {/* The evidence given to the seller (s72A; 0117): a file, or part of the notice. */}
            <div className="space-y-2 rounded-md border border-rc-border px-3 py-2.5">
              <div>
                <p className="text-sm text-rc-ink">{EVIDENCE_LABEL}</p>
                <p className="text-[11px] text-rc-faint">{EVIDENCE_HINT}</p>
              </div>
              <input type="hidden" name="evidencePath" value={evidence?.path ?? ""} />
              <input type="hidden" name="evidenceFileName" value={evidence?.name ?? ""} />
              {evidence ? (
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-rc-ink">
                    <Paperclip size={12} aria-hidden="true" /> {evidence.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEvidence(null)}
                    disabled={saving}
                    className="text-rc-green-deep hover:underline disabled:opacity-60"
                  >
                    Remove
                  </button>
                </p>
              ) : (
                !inNotice && (
                  <FileDropZone
                    compact
                    file={evidenceFile}
                    onFile={pickEvidence}
                    disabled={evidenceBusy || saving}
                    label={evidenceBusy ? "Uploading…" : "Drag the evidence here, or click to browse"}
                  />
                )
              )}
              {evidenceError && (
                <p role="alert" className="text-xs font-medium text-rc-amber-deep">
                  {evidenceError}
                </p>
              )}
              {!evidence && (
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    name="evidenceInNotice"
                    value="yes"
                    checked={inNotice}
                    onChange={(e) => setInNotice(e.target.checked)}
                    className="mt-0.5 shrink-0 accent-rc-green-deep"
                  />
                  <span className="text-xs text-rc-ink">{EVIDENCE_IN_NOTICE_LABEL}</span>
                </label>
              )}
            </div>
            </>
          ) : (
            <>
              <input type="hidden" name="previousEspLow" value={prevLow} />
              <input type="hidden" name="previousEspHigh" value={prevHigh} />
              <input type="hidden" name="evidencePath" value={evidence?.path ?? ""} />
              <input type="hidden" name="evidenceFileName" value={evidence?.name ?? ""} />
            </>
          )}

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
                  s72A.{" "}
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
                  {advertisingFixLine()}
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
            disabled={saving || cancelling || evidenceBusy || feedbackBusy}
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
