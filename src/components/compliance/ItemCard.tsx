"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Paperclip, Sparkles, AlertTriangle, Check, X } from "lucide-react";
import type { ComplianceItem } from "@/lib/rules/nsw-sales";
import { getPrescribedDoc } from "@/lib/rules/nsw-prescribed-documents";
import { SignoffLinkPanel } from "@/components/signoff/SignoffLinkPanel";
import type { Profile, PropertyItem } from "@/lib/types";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { EVIDENCE_BUCKET, buildEvidencePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import {
  setItemStatus,
  addOfferEntry,
  addReportEntry,
  markEspRevised,
  markNoPriceRevision,
  addVerbalQuoteEntry,
  markNoVerbalQuotes,
  recordSale,
  signItem,
  sendToLicensee,
  generateExport,
  uploadEvidence,
  removeEvidence,
  type ActionState,
} from "@/lib/actions/compliance";
import { extractReportDetails, type ReportExtractionFields } from "@/lib/actions/extraction";
import { DictatableTextarea } from "@/components/Dictate";

const initialState: ActionState = { error: null };

function StatusPill({ status }: { status?: PropertyItem["status"] }) {
  if (!status || status === "open") {
    return (
      <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-rc-muted">
        Open
      </span>
    );
  }
  if (status === "flagged") {
    return (
      <span className="rounded-full bg-rc-amber/15 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep">
        Flagged
      </span>
    );
  }
  // Labelled, like Open and Flagged. It used to be an icon-only tick circle,
  // which made the one state you most want confirmation of the least legible
  // of the three (Adam, 14 Aug 2026: a completed item "can be confusing and
  // look like the task has not been marked as complete"). The word carries it
  // where a small glyph did not.
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rc-green-soft px-2.5 py-0.5 text-xs font-semibold text-rc-green-deep">
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.415l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25a1 1 0 111.415-1.414l2.542 2.543 6.543-6.543a1 1 0 011.415 0z"
          clipRule="evenodd"
        />
      </svg>
      Done
    </span>
  );
}

function ItemShell({
  item,
  status,
  propertyId,
  current,
  children,
}: {
  item: ComplianceItem;
  status?: PropertyItem["status"];
  propertyId: string;
  current?: PropertyItem;
  children: ReactNode;
}) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-rc-ink">{item.label}</h3>
            {item.licenseeOnly && (
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rc-muted">
                Licensee
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-rc-muted">{item.description}</p>
          {item.legalBasis && (
            <p className="mt-1 text-xs text-rc-faint">{item.legalBasis}</p>
          )}
        </div>
        <StatusPill status={status} />
      </div>
      <div className="mt-3">{children}</div>
      {!item.hideEvidence && (
        <EvidenceUploader
          key={current?.evidence_path ?? "none"}
          propertyId={propertyId}
          itemKey={item.key}
          evidencePath={current?.evidence_path ?? null}
          evidenceFileName={(current?.data as { evidenceFileName?: string } | undefined)?.evidenceFileName}
        />
      )}
    </div>
  );
}

function FieldError({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="mt-2 text-sm text-rc-amber-deep">{error}</p>;
}

// Small inline flag for a cl 37 field the AI extraction didn't find in the
// document — colour + icon carries the warning instead of an emoji glyph.
function NotStated({ text = "not stated in the document" }: { text?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-rc-amber-deep">
      <AlertTriangle size={11} className="shrink-0" /> {text}
    </span>
  );
}

// Evidence attachment — one file per item, uploaded to a private Supabase
// Storage bucket (supabase/migrations/0002_evidence_storage.sql). Shown on
// every item kind since evidence can apply broadly (a signed agreement, a
// pool certificate, a comparable-sales report), not just the "evidence"
// items in the rules file. Signed URLs are fetched client-side so they're
// generated fresh per view rather than baked into server-rendered HTML.
// Uploads straight to Supabase Storage from the browser, then hands only
// the resulting path (a short string) to the uploadEvidence Server Action
// to record. A Server Action can't reliably carry the file bytes itself —
// Vercel Functions hard-cap every request body at 4.5MB, well under real
// contracts/agreements/comps reports — see src/lib/storage/evidence.ts.
function EvidenceUploader({
  propertyId,
  itemKey,
  evidencePath,
  evidenceFileName,
}: {
  propertyId: string;
  itemKey: string;
  evidencePath: string | null;
  evidenceFileName?: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const uploadAction = uploadEvidence.bind(null, propertyId, itemKey);
  const [uploadState, uploadFormAction, uploadPending] = useActionState(uploadAction, initialState);
  const removeAction = removeEvidence.bind(null, propertyId, itemKey);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!evidencePath) return;
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(evidencePath, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [evidencePath]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;

    setClientError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle()
      : { data: null };

    if (!profile?.agency_id) {
      setClientError("Couldn't confirm your agency — try reloading the page.");
      setUploading(false);
      return;
    }

    const path = buildEvidencePath(profile.agency_id, propertyId, itemKey, selectedFile.name);
    const { error } = await uploadEvidenceObject(supabase, { path, file: selectedFile });
    setUploading(false);
    if (error) {
      setClientError(error);
      return;
    }

    const fd = new FormData();
    fd.set("path", path);
    fd.set("fileName", selectedFile.name);
    uploadFormAction(fd);
  }

  return (
    <div className="mt-3 border-t border-rc-border pt-3">
      <p className="text-xs font-medium text-rc-muted">Evidence</p>
      {evidencePath ? (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-rc-green-deep hover:underline"
            >
              <Paperclip size={13} /> {evidenceFileName ?? "View file"}
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-rc-faint">
              <Paperclip size={13} /> {evidenceFileName ?? "file"} (loading link…)
            </span>
          )}
          <form action={removeAction}>
            <button
              type="submit"
              className="text-xs text-rc-faint transition hover:text-rc-amber-deep hover:underline"
            >
              Remove
            </button>
          </form>
        </div>
      ) : (
        // Choosing a file and attaching it are two steps, and missing the
        // second one used to leave no trace: the browser prints the chosen
        // filename next to the picker, which reads exactly like confirmation
        // that something was saved. Adam lost a comparable-sales report that
        // way on 14 Aug 2026 and believed it was on file for days. Adam's
        // call was to keep both steps but make the gap unmissable, so a
        // pending choice now turns the whole row amber and says plainly that
        // nothing has been attached yet.
        <form
          onSubmit={handleSubmit}
          className={`mt-1 rounded-lg border p-2 transition ${
            selectedFile ? "border-rc-amber bg-rc-amber/10" : "border-transparent"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              required
              onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
              className="text-xs text-rc-muted file:mr-2 file:rounded-md file:border file:border-rc-border file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium"
            />
            <button
              type="submit"
              disabled={uploading || uploadPending}
              className={
                selectedFile
                  ? "rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
                  : "rounded-md border border-rc-border px-2 py-1 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt disabled:opacity-60"
              }
            >
              {uploading ? "Uploading…" : uploadPending ? "Saving…" : "Attach file"}
            </button>
          </div>
          {selectedFile && !uploading && !uploadPending && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-rc-amber-deep">
              <AlertTriangle size={12} className="shrink-0" />
              Not attached yet — press Attach file to save it.
            </p>
          )}
        </form>
      )}
      <FieldError error={clientError ?? uploadState.error} />
    </div>
  );
}

// Default: `checklist` kind — mark done/flag, optional note + date. a4
// (the ESP) additionally captures structured low/high figures, since the
// live underquoting checks elsewhere need real numbers, not free text.
function ChecklistItem({
  item,
  propertyId,
  current,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
}) {
  const boundAction = setItemStatus.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const status = current?.status;
  const isDone = status === "done";

  const data = (current?.data ?? {}) as {
    note?: string;
    espLow?: number;
    espHigh?: number;
    materialFactDisclosed?: boolean;
    aiDraft?: {
      note?: string;
      espLow?: number;
      espHigh?: number;
      eventDate?: string;
      consumerGuideProvided?: boolean;
      autoCompleted?: boolean;
      guideNotFound?: boolean;
      prescribedDocs?: { key: string; found: boolean }[];
      notAContract?: boolean;
    };
  };
  const draft = data.aiDraft;

  // Live ESP spread. s72A(2) allows a range only where the high exceeds the low
  // by no more than 10% OF THE LOW — not 10% of the high, and not a flat
  // 10-point gap, both of which are easy to eyeball wrong on a big number.
  // Shown as you type rather than only after saving, because finding out you
  // breached once the figures are already on the agreement is finding out too
  // late (Adam, 15 Aug 2026).
  //
  // This decides nothing. setItemStatus recomputes the same sum server-side and
  // is what actually flags the item; this only tells the agent before they
  // commit. Two implementations of one rule is a real risk, so if the threshold
  // ever moves, both move together.
  const [espLowIn, setEspLowIn] = useState<string>(String(data.espLow ?? draft?.espLow ?? ""));
  const [espHighIn, setEspHighIn] = useState<string>(String(data.espHigh ?? draft?.espHigh ?? ""));
  const lowNum = Number(espLowIn) || 0;
  const highNum = Number(espHighIn) || 0;
  const spreadPct =
    lowNum > 0 && highNum > 0 && highNum >= lowNum ? ((highNum - lowNum) / lowNum) * 100 : null;
  const spreadOver = spreadPct !== null && spreadPct > 10;
  // The highest compliant top figure, so a breach arrives with its own fix.
  const maxHigh = lowNum > 0 ? Math.floor(lowNum * 1.1) : null;
  // A spread barely over the limit rounds to "10.0" at any sane precision — a
  // dollar over on a million still prints as 10.000% — so showing the number
  // beside a red "over the limit" reads as a contradiction, and adding decimals
  // only moves the problem. Where the figure cannot distinguish itself from the
  // threshold, say so in words instead of pretending precision. The fix (the
  // highest compliant top figure) is shown either way, and that is the part the
  // agent actually acts on.
  const spreadMarginal = spreadOver && spreadPct !== null && spreadPct.toFixed(1) === "10.0";

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-3">
        {draft?.autoCompleted ? (
          <p className="flex items-start gap-1.5 rounded-lg bg-rc-green-soft px-2.5 py-1.5 text-xs text-rc-green-deep">
            <Sparkles size={13} className="mt-0.5 shrink-0" />
            <span>
              Auto-marked done — the agency agreement explicitly confirmed the guide was given, dated{" "}
              {draft.eventDate}. Check it against the source; use Reopen below if that&apos;s not right.
            </span>
          </p>
        ) : draft?.guideNotFound ? (
          // Distinct from an untouched item. The agreement WAS read and the
          // vendor's acknowledgement was not in it, which is worth saying out
          // loud: silence looks identical to nobody having checked, and this
          // card has no note box to carry the message.
          <p className="flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-1.5 text-xs text-rc-amber-deep">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Read the agency agreement and couldn&apos;t find the vendor&apos;s acknowledgement that the guide was
              given. It may still have been given separately — confirm it yourself and enter the date.
            </span>
          </p>
        ) : (
          draft &&
          !item.showFindings && (
            <p className="flex items-center gap-1.5 rounded-lg bg-rc-green-soft px-2.5 py-1.5 text-xs text-rc-green-deep">
              <Sparkles size={13} className="shrink-0" />
              Pre-filled from an uploaded document — check it against the source, then save.
            </p>
          )
        )}
        {item.key === "a7" && (
          <div>
            <label className="block text-xs text-rc-muted">Material fact disclosed by the vendor?</label>
            <select
              name="materialFactDisclosed"
              defaultValue={data.materialFactDisclosed === true ? "yes" : data.materialFactDisclosed === false ? "no" : ""}
              className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
            >
              <option value="" disabled>
                Choose one
              </option>
              <option value="no">None disclosed</option>
              <option value="yes">Yes — disclosed</option>
            </select>
            <p className="mt-1 text-xs text-rc-faint">
              Answering &ldquo;yes&rdquo; adds an item at Under offer to confirm it&rsquo;s been passed on to the purchaser.
            </p>
          </div>
        )}
        {item.key === "a4" && (
          <div>
            <div className="flex gap-3">
              <div>
                <label className="block text-xs text-rc-muted" htmlFor="esp-low">
                  ESP low
                </label>
                <input
                  id="esp-low"
                  type="number"
                  name="espLow"
                  value={espLowIn}
                  onChange={(e) => setEspLowIn(e.target.value)}
                  className="mt-1 w-32 rounded-md border border-rc-border px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-rc-muted" htmlFor="esp-high">
                  ESP high (optional)
                </label>
                <input
                  id="esp-high"
                  type="number"
                  name="espHigh"
                  value={espHighIn}
                  onChange={(e) => setEspHighIn(e.target.value)}
                  className={`mt-1 w-32 rounded-md border px-2 py-1 text-sm ${
                    spreadOver ? "border-rc-red bg-rc-red-soft" : "border-rc-border"
                  }`}
                />
              </div>
            </div>

            {/* The one thing worth saying about a range, said with arithmetic
                rather than by a model. Silent for a single figure, since a
                spread needs two numbers to exist. */}
            {spreadPct !== null && (
              <p
                className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  spreadOver ? "bg-rc-red-soft text-rc-red" : "bg-rc-green-soft text-rc-green-deep"
                }`}
                role={spreadOver ? "alert" : undefined}
              >
                {spreadOver ? (
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                ) : (
                  <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M16.704 5.29a1 1 0 010 1.415l-7.25 7.25a1 1 0 01-1.415 0l-3.25-3.25a1 1 0 111.415-1.414l2.542 2.543 6.543-6.543a1 1 0 011.415 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                <span>
                  {spreadMarginal ? (
                    <>
                      Just over the 10% limit in s72A(2). The highest this range can go on a $
                      {lowNum.toLocaleString()} low is ${maxHigh?.toLocaleString()}.
                    </>
                  ) : spreadOver ? (
                    <>
                      {spreadPct.toFixed(1)}% spread. Over the 10% limit in s72A(2). The highest this range can go
                      on a ${lowNum.toLocaleString()} low is ${maxHigh?.toLocaleString()}.
                    </>
                  ) : (
                    <>{spreadPct.toFixed(1)}% spread. Within the 10% limit in s72A(2).</>
                  )}
                </span>
              </p>
            )}
          </div>
        )}
        {item.requiresDate && (
          <div>
            <label className="block text-xs text-rc-muted">Event date</label>
            <input
              type="date"
              name="eventDate"
              defaultValue={current?.event_date ?? draft?.eventDate ?? ""}
              className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
            />
          </div>
        )}
        {/* The s52A prescribed-document check, item b1 only.
            Adam, 15 Aug 2026: "we do wanna perform a search on the prescribed
            documents, and we wanna flag it if they are not there, but we also
            wanna confirm the ones that are." Hence a list with both answers on
            it, rather than the previous behaviour of mentioning only what was
            missing and staying silent when everything was found. Silence is
            ambiguous — it reads the same as the check never having run.

            Not-found is worded as "not found in the file" rather than "missing"
            and does NOT set the item's status. The AI is reading a PDF that may
            be one part of a contract assembled by a solicitor, so a false
            not-found is entirely possible; letting it flag the item outright
            would put a red mark on a compliant file. It goes to the agent, who
            decides, which is the same rule every other AI output here follows. */}
        {draft?.prescribedDocs && draft.prescribedDocs.length > 0 && (
          <div>
            <label className="block text-xs text-rc-muted">
              s52A prescribed documents{" "}
              <span className="font-normal text-rc-faint">(checked against the uploaded contract)</span>
            </label>
            <ul className="mt-1 divide-y divide-rc-border rounded-md border border-rc-border bg-white">
              {draft.prescribedDocs.map((d) => {
                const meta = getPrescribedDoc(d.key);
                if (!meta) return null;
                return (
                  <li key={d.key} className="flex items-start gap-2.5 px-2.5 py-2">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                        d.found ? "bg-rc-green-deep text-white" : "bg-rc-amber-deep text-white"
                      }`}
                      aria-hidden="true"
                    >
                      {d.found ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm leading-snug text-rc-ink">
                        {meta.label}
                        {!d.found && (
                          <span className="font-medium text-rc-amber-deep"> — not found in the file</span>
                        )}
                      </span>
                      <span className="block text-[11px] leading-snug text-rc-faint">{meta.source}</span>
                      {!d.found && meta.conditional && (
                        <span className="mt-0.5 block text-[11px] leading-snug text-rc-muted">
                          {meta.conditional}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
              {draft.prescribedDocs.every((d) => d.found)
                ? "All of them were found in the contract as uploaded. Your solicitor prepares and confirms the contract; this is a second look, not their sign-off."
                : "Anything not found may still be there — it could sit in a part of the contract that was not uploaded. Check with the solicitor who prepared it before the property goes to market."}
            </p>
          </div>
        )}

        {/* Sign-off by link, for a licensee in charge who does not use
            RealComply. Sits on send_licensee rather than sign_licensee
            because sign_licensee is licenseeOnly and an agent cannot touch
            it — which is the whole problem this solves. */}
        {item.key === "send_licensee" && <SignoffLinkPanel propertyId={propertyId} />}

        {item.showFindings ? (
          <div>
            <label className="block text-xs text-rc-muted">
              Findings <span className="font-normal text-rc-faint">(from AI extraction, not for manual entry)</span>
            </label>
            {/* whitespace-pre-line so a finding that genuinely needs more than
                one line keeps its breaks instead of collapsing into a block of
                run-on text. Most findings are a single sentence, and the a4b
                prompt was tightened so they stay that way — this is for the
                ones that legitimately are not. leading-relaxed because these
                are read, not skimmed. */}
            <p className="mt-1 whitespace-pre-line rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2 text-sm leading-relaxed text-rc-ink">
              {(data.note ?? draft?.note ?? "").trim() || "No findings to action"}
            </p>
            {/* Carries the current finding through Mark done/Flag/Reopen so it isn't wiped by
                a submit — this field has no editable input, so formData wouldn't otherwise include it. */}
            <input type="hidden" name="note" value={data.note ?? draft?.note ?? ""} readOnly />
          </div>
        ) : (
          !item.hideNote && (
            <div>
              <label className="block text-xs text-rc-muted">Note</label>
              <DictatableTextarea
                name="note"
                defaultValue={data.note ?? draft?.note ?? ""}
                rows={2}
                className="mt-1 w-full rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
          )
        )}
        {/* The actions reflect the item's state rather than being fixed.
            Previously "Mark done" stayed full-strength green after an item was
            completed, which reads as an outstanding action and had Adam
            doubting whether his tick had saved (14 Aug 2026).

            The LABEL DELIBERATELY DOES NOT CHANGE. An earlier pass swapped it
            to "Save changes" once done; Adam preferred "Mark done" throughout
            and he is right — a control whose wording moves under you is harder
            to learn than one that only changes weight. Only the styling
            differs: solid green while outstanding, then a faded white box with
            grey text once complete, returning to full strength on hover so it
            is still obviously reachable.

            It submits status=done in both states and stays enabled when
            complete, because this same form carries the date, note and
            findings, and re-submitting is how those get edited. Disabling it
            would make a finished item uneditable. "Reopen" is hidden on an
            item that is already open, where it did nothing. */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="status"
            value="done"
            disabled={pending}
            className={
              isDone
                ? "rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted opacity-70 transition hover:border-rc-ink/20 hover:opacity-100 disabled:opacity-40"
                : "rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            }
          >
            Mark done
          </button>
          {(isDone || status === "flagged") && (
            <button
              type="submit"
              name="status"
              value="open"
              disabled={pending}
              className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt disabled:opacity-60"
            >
              Reopen
            </button>
          )}
        </div>
      </form>
      <FieldError error={state.error} />
    </ItemShell>
  );
}

// c1 — the live underquoting check: advertised guide vs the recorded ESP
// (a4). This is the product's core "don't just tick it, compute it" USP —
// the flag fires from real numbers, not a static checkbox (the prohibited-
// term and spread checks run server-side in setItemStatus).
function GuideItem({
  item,
  propertyId,
  current,
  espItem,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
  espItem?: PropertyItem;
}) {
  const boundAction = setItemStatus.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { note?: string; flagReasons?: string[] };
  const esp = (espItem?.data ?? {}) as { espLow?: number; espHigh?: number };

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {esp.espLow == null ? (
        <p className="text-sm text-rc-muted">Record the ESP (item a4) first — the live check needs it.</p>
      ) : (
        <p className="text-xs text-rc-faint">Recorded ESP: ${esp.espLow.toLocaleString()}
          {esp.espHigh && esp.espHigh !== esp.espLow ? ` – $${esp.espHigh.toLocaleString()}` : ""}
        </p>
      )}
      <form action={formAction} className="mt-2 space-y-3">
        <div className="flex gap-3">
          <input type="number" name="guideLow" placeholder="Guide low" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
          <input type="number" name="guideHigh" placeholder="Guide high (optional)" className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm" />
        </div>
        <DictatableTextarea name="note" defaultValue={data.note ?? ""} placeholder="Exact wording used in the ad" rows={2} className="w-full rounded-md border border-rc-border px-2 py-1 text-sm" />
        {/* Same state-aware treatment as ChecklistItem. This one stays fully
            usable once recorded, because re-recording is a real action here (a
            guide genuinely changes during a campaign) — it just stops shouting
            once a guide is on file. */}
        <div className="flex gap-2">
          <button
            type="submit"
            name="status"
            value="done"
            disabled={pending}
            className={
              current?.status === "done"
                ? "rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-medium text-rc-muted opacity-70 transition hover:border-rc-ink/20 hover:opacity-100 disabled:opacity-40"
                : "rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            }
          >
            Record guide
          </button>
        </div>
      </form>
      <FieldError error={state.error} />
      {data.flagReasons && data.flagReasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-rc-amber-deep">
          {data.flagReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

function OffersLogItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = addOfferEntry.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as {
    entries?: Array<{
      amount: number;
      outcome: string;
      vendorInformed: boolean;
      belowFloor: boolean;
      note: string;
      recordedAt: string;
    }>;
    flagReason?: string;
  };
  const entries = data.entries ?? [];

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-2 rounded-lg bg-rc-bg-alt p-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            name="amount"
            placeholder="Offer amount"
            className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
          <select name="outcome" className="rounded-md border border-rc-border px-2 py-1 text-sm">
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs text-rc-muted">
          <input type="checkbox" name="vendorInformed" /> Vendor informed in writing
        </label>
        <label className="flex items-center gap-2 text-xs text-rc-muted">
          <input type="checkbox" name="belowFloor" /> Below the vendor&rsquo;s written offer-floor instruction (exempt)
        </label>
        <DictatableTextarea
          name="note"
          placeholder="Note"
          rows={2}
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          Log offer
        </button>
      </form>
      <FieldError error={state.error} />
      {data.flagReason && (
        <p className="mt-2 text-sm text-rc-amber-deep">{data.flagReason}</p>
      )}
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-rc-muted">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              <span className="font-medium text-rc-ink">${e.amount.toLocaleString()}</span> — {e.outcome}
              {e.vendorInformed ? " · vendor informed" : " · vendor not yet informed"}
              {e.note && <> — {e.note}</>}
            </li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

// Shows a past register entry's attached report as a clickable link — same
// signed-URL pattern as EvidenceUploader above, generated fresh per view.
function ReportEvidenceLink({ path, fileName }: { path: string; fileName: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();
    supabase.storage
      .from(EVIDENCE_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled) setSignedUrl(data?.signedUrl ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!signedUrl) {
    return (
      <span className="inline-flex items-center gap-1 text-rc-faint">
        <Paperclip size={13} /> {fileName}
      </span>
    );
  }
  return (
    <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-rc-green-deep hover:underline">
      <Paperclip size={13} /> {fileName}
    </a>
  );
}

// f3 — the cl 37 report register. The agent just uploads the report; every
// cl 37 field is read straight from it via extractReportDetails, shown
// read-only (same "Findings, not a form" idea as b1) so there's nothing left
// to manually re-type. Whatever the document doesn't state is flagged rather
// than silently dropped — cl 37 needs the gap visible, not hidden by an
// empty-looking form field. "Who requested it" isn't something a report
// document states about itself, so it's not something extraction can check;
// the note field is where that goes if it matters for this entry.
function ReportsLogItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = addReportEntry.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const entries =
    ((current?.data ?? {}) as {
      entries?: Array<{
        pestInspection: boolean;
        buildingInspection: boolean;
        strata: boolean;
        inspectionDate: string;
        preparerName: string;
        preparerContact: string;
        preparerInsured: boolean;
        availableForRepurchase: boolean;
        note: string;
        evidencePath: string | null;
        evidenceFileName: string | null;
        missingFields: string[];
        recordedAt: string;
      }>;
    }).entries ?? [];

  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ path: string; fileName: string } | null>(null);
  const [draft, setDraft] = useState<ReportExtractionFields | null>(null);
  const wasPending = useRef(pending);

  // Reset the upload/extraction state once a submission actually succeeds,
  // so the form is ready for the next entry rather than carrying over the
  // previous upload.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      setUploading(false);
      setExtracting(false);
      setClientError(null);
      setEvidence(null);
      setDraft(null);
    }
    wasPending.current = pending;
  }, [pending, state.error]);

  async function handleFileSelected(file: File) {
    setClientError(null);
    setUploading(true);
    const supabase = createBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = user
      ? await supabase.from("profiles").select("agency_id").eq("id", user.id).maybeSingle()
      : { data: null };

    if (!profile?.agency_id) {
      setClientError("Couldn't confirm your agency — try reloading the page.");
      setUploading(false);
      return;
    }

    const path = buildEvidencePath(profile.agency_id, propertyId, item.key, file.name);
    const { error } = await uploadEvidenceObject(supabase, { path, file });
    setUploading(false);
    if (error) {
      setClientError(error);
      return;
    }

    setEvidence({ path, fileName: file.name });
    setExtracting(true);
    const { error: extractError, fields } = await extractReportDetails(path, file.name);
    setExtracting(false);
    if (extractError) {
      setClientError(extractError);
      return;
    }
    setDraft(fields ?? {});
  }

  const reportType = draft
    ? [draft.pestInspection && "Pest", draft.buildingInspection && "Building", draft.strata && "Strata"]
        .filter(Boolean)
        .join(" + ") || "not identified"
    : null;

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-3 rounded-lg bg-rc-bg-alt p-3">
        <div>
          <label className="block text-xs font-medium text-rc-muted">Upload the report</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file) handleFileSelected(file);
              }}
              disabled={uploading || extracting}
              className="text-xs text-rc-muted file:mr-2 file:rounded-md file:border file:border-rc-border file:bg-white file:px-2 file:py-1 file:text-xs file:font-medium"
            />
            {(uploading || extracting) && (
              <span className="text-xs text-rc-faint">{uploading ? "Uploading…" : "Reading report…"}</span>
            )}
          </div>
          <FieldError error={clientError} />
          <input type="hidden" name="evidencePath" value={evidence?.path ?? ""} readOnly />
          <input type="hidden" name="evidenceFileName" value={evidence?.fileName ?? ""} readOnly />
          <input type="hidden" name="pestInspection" value={draft?.pestInspection ? "true" : ""} readOnly />
          <input type="hidden" name="buildingInspection" value={draft?.buildingInspection ? "true" : ""} readOnly />
          <input type="hidden" name="strata" value={draft?.strata ? "true" : ""} readOnly />
          <input type="hidden" name="inspectionDate" value={draft?.inspectionDate ?? ""} readOnly />
          <input type="hidden" name="preparerName" value={draft?.preparerName ?? ""} readOnly />
          <input type="hidden" name="preparerContact" value={draft?.preparerContact ?? ""} readOnly />
          <input type="hidden" name="preparerInsured" value={draft?.preparerInsured ? "true" : ""} readOnly />
          <input
            type="hidden"
            name="availableForRepurchase"
            value={draft?.availableForRepurchase ? "true" : ""}
            readOnly
          />
        </div>

        {draft && (
          <div className="rounded-lg border border-rc-border bg-white p-3 text-xs text-rc-muted">
            <p className="flex items-center gap-1.5 font-medium text-rc-muted">
              <Sparkles size={12} className="text-rc-green-deep" />
              From the report <span className="font-normal text-rc-faint">(read by AI — check it against the document)</span>
            </p>
            <ul className="mt-1.5 space-y-1">
              <li>Type: {reportType}</li>
              <li>Inspected: {draft.inspectionDate || <NotStated />}</li>
              <li>
                Preparer: {draft.preparerName || <NotStated />}
                {draft.preparerContact ? ` (${draft.preparerContact})` : draft.preparerName ? <> · <NotStated text="contact not stated" /></> : null}
              </li>
              <li>PI insurance: {draft.preparerInsured ? "confirmed in the document" : <NotStated />}</li>
              <li>
                Available for repurchase: {draft.availableForRepurchase ? "confirmed in the document" : <NotStated />}
              </li>
            </ul>
            <p className="mt-1.5 text-rc-faint">
              Cl 37 also asks who requested the report — that&rsquo;s rarely written in the report itself, so add it in the note below if it matters.
            </p>
          </div>
        )}

        <DictatableTextarea
          name="note"
          placeholder="Note — e.g. who requested this report, or anything else worth recording (optional)"
          rows={2}
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending || uploading || extracting}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Log entry"}
        </button>
      </form>
      <FieldError error={state.error} />
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-rc-muted">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              <span className="font-medium text-rc-ink">
                {[e.pestInspection && "Pest", e.buildingInspection && "Building", e.strata && "Strata"]
                  .filter(Boolean)
                  .join(" + ") || "Report"}
              </span>{" "}
              — prepared by {e.preparerName || "unknown"}
              {e.preparerContact && ` (${e.preparerContact})`}
              {e.preparerInsured ? ", PI insured" : ""}
              {e.inspectionDate && ` · inspected ${e.inspectionDate}`}
              {e.availableForRepurchase && " · available for repurchase"}
              {e.note && <> — {e.note}</>}
              {e.evidencePath && e.evidenceFileName && (
                <>
                  {" · "}
                  <ReportEvidenceLink path={e.evidencePath} fileName={e.evidenceFileName} />
                </>
              )}
              {e.missingFields && e.missingFields.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-rc-amber-deep">
                  <AlertTriangle size={12} className="shrink-0" /> Not stated in the document: {e.missingFields.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </ItemShell>
  );
}

// d3 — simplified (12 Aug 2026) to a plain Yes/No question: did the ESP
// need to be revised during the campaign? "No" marks the item done
// immediately. "Yes" also marks it done — the notice sent to the vendor is
// attached via the item's own generic evidence uploader (rendered below by
// ItemShell, since d3 doesn't hideEvidence), not retyped into a form here.
// "Change answer" is local-only UI state so either outcome can be
// reconsidered without a confirm dialog; picking a new answer overwrites
// the stored one.
function ReductionItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const yesAction = markEspRevised.bind(null, propertyId);
  const noAction = markNoPriceRevision.bind(null, propertyId);
  const data = (current?.data ?? {}) as { espRevised?: boolean };
  const [reconsidering, setReconsidering] = useState(false);
  const answered = data.espRevised !== undefined && !reconsidering;

  if (!answered) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        <div className="space-y-2">
          <p className="text-sm text-rc-muted">Did the ESP need to be revised during this campaign?</p>
          <div className="flex gap-2">
            <form action={noAction} onSubmit={() => setReconsidering(false)}>
              <button
                type="submit"
                className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt"
              >
                No
              </button>
            </form>
            <form action={yesAction} onSubmit={() => setReconsidering(false)}>
              <button
                type="submit"
                className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              >
                Yes
              </button>
            </form>
          </div>
        </div>
      </ItemShell>
    );
  }

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <p className="text-sm text-rc-muted">
        {data.espRevised
          ? "ESP was revised — attach the notice sent to the vendor below."
          : "Marked — the ESP wasn't revised on this listing."}{" "}
        <button type="button" onClick={() => setReconsidering(true)} className="text-rc-green-deep hover:underline">
          Change answer
        </button>
      </p>
    </ItemShell>
  );
}

// b5 — verbal price-quote log. Same shape as ReductionItem above: a Yes/No
// gate that either fast-paths to "nothing to log" or opens a repeating
// entry form. Logging an entry here is itself the written record the Price
// Reps checklist requires for a verbal price statement — there's no
// separate confirmation step because this IS that step.
function VerbalQuoteLogItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = addVerbalQuoteEntry.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const noQuotesAction = markNoVerbalQuotes.bind(null, propertyId);
  const data = (current?.data ?? {}) as { entries?: Array<Record<string, unknown>>; noQuotes?: boolean };
  const entries = data.entries ?? [];
  const [showForm, setShowForm] = useState(entries.length > 0);

  if (!showForm) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        {data.noQuotes ? (
          <p className="text-sm text-rc-muted">
            Marked — no verbal quotes given yet.{" "}
            <button type="button" onClick={() => setShowForm(true)} className="text-rc-green-deep hover:underline">
              Actually, log one
            </button>
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-rc-muted">Has a price figure been given to anyone verbally yet?</p>
            <div className="flex gap-2">
              <form action={noQuotesAction}>
                <button
                  type="submit"
                  className="rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt"
                >
                  No — nothing to log yet
                </button>
              </form>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
              >
                Yes — log it
              </button>
            </div>
          </div>
        )}
      </ItemShell>
    );
  }

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="space-y-2 rounded-lg bg-rc-bg-alt p-3">
        <div className="flex gap-3">
          <input
            type="number"
            name="amount"
            placeholder="Figure quoted"
            className="w-40 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
        </div>
        <textarea
          name="context"
          placeholder="Who it was given to / the context (e.g. buyer at Saturday's open home)"
          rows={2}
          className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          Log quote
        </button>
      </form>
      <FieldError error={state.error} />
      {entries.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm text-rc-muted">
          {entries.map((e, i) => (
            <li key={i} className="border-t border-rc-border pt-2">
              ${Number(e.amount).toLocaleString()} — {String(e.context)}
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && (
        <button
          type="button"
          onClick={() => setShowForm(false)}
          className="mt-2 text-xs text-rc-faint transition hover:underline"
        >
          ← Back
        </button>
      )}
    </ItemShell>
  );
}

function SaleItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const boundAction = recordSale.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { price?: number; outsideRange?: boolean; flagReason?: string };

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="flex gap-2">
        <input
          type="number"
          name="price"
          defaultValue={data.price ?? ""}
          placeholder="Final sale price"
          className="w-48 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          Record
        </button>
      </form>
      <FieldError error={state.error} />
      {data.flagReason && <p className="mt-2 text-sm text-rc-amber-deep">{data.flagReason}</p>}
    </ItemShell>
  );
}

function SignItem({ item, propertyId, current, profile }: { item: ComplianceItem; propertyId: string; current?: PropertyItem; profile: Profile }) {
  const boundAction = signItem.bind(null, propertyId, item.key);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const data = (current?.data ?? {}) as { typedName?: string; signedAt?: string };

  if (item.licenseeOnly && !profile.is_licensee_in_charge) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        <p className="text-sm text-rc-muted">Waiting on the licensee in charge to sign.</p>
      </ItemShell>
    );
  }

  if (data.signedAt) {
    return (
      <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
        <p className="text-sm text-rc-muted">
          Signed <span className="font-medium text-rc-ink">{data.typedName}</span> on{" "}
          {new Date(data.signedAt).toLocaleString("en-AU")}
        </p>
      </ItemShell>
    );
  }

  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      <form action={formAction} className="flex gap-2">
        <input
          type="text"
          name="typedName"
          placeholder="Type your full name"
          className="flex-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          Adopt as signature
        </button>
      </form>
      <FieldError error={state.error} />
    </ItemShell>
  );
}

function SendItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const action = sendToLicensee.bind(null, propertyId);
  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {current?.status === "done" ? (
        <p className="text-sm text-rc-muted">Marked sent.</p>
      ) : (
        <form action={action}>
          <button
            type="submit"
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Mark sent to licensee
          </button>
        </form>
      )}
    </ItemShell>
  );
}

function ExportItem({ item, propertyId, current }: { item: ComplianceItem; propertyId: string; current?: PropertyItem }) {
  const action = generateExport.bind(null, propertyId);
  return (
    <ItemShell item={item} status={current?.status} propertyId={propertyId} current={current}>
      {current?.status === "done" ? (
        <p className="text-sm text-rc-muted">
          Generated {new Date((current.data as { generatedAt?: string }).generatedAt ?? current.created_at).toLocaleString("en-AU")}.{" "}
          <a href={`/dashboard/${propertyId}/summary`} className="text-rc-green-deep hover:underline">
            View the finalised summary
          </a>
        </p>
      ) : (
        <form action={action}>
          <button
            type="submit"
            className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Generate finalised file
          </button>
        </form>
      )}
    </ItemShell>
  );
}

export function ItemCard({
  item,
  propertyId,
  current,
  profile,
  allItems,
}: {
  item: ComplianceItem;
  propertyId: string;
  current?: PropertyItem;
  profile: Profile;
  allItems: Record<string, PropertyItem>;
}) {
  switch (item.kind) {
    case "offers":
      return <OffersLogItem item={item} propertyId={propertyId} current={current} />;
    case "reports":
      return <ReportsLogItem item={item} propertyId={propertyId} current={current} />;
    case "reduction":
      return <ReductionItem item={item} propertyId={propertyId} current={current} />;
    case "quotes":
      return <VerbalQuoteLogItem item={item} propertyId={propertyId} current={current} />;
    case "sale":
      return <SaleItem item={item} propertyId={propertyId} current={current} />;
    case "sign":
      return <SignItem item={item} propertyId={propertyId} current={current} profile={profile} />;
    case "send":
      return <SendItem item={item} propertyId={propertyId} current={current} />;
    case "export":
      return <ExportItem item={item} propertyId={propertyId} current={current} />;
    case "guide":
      return <GuideItem item={item} propertyId={propertyId} current={current} espItem={allItems["a4"]} />;
    case "checklist":
    default:
      return <ChecklistItem item={item} propertyId={propertyId} current={current} />;
  }
}
