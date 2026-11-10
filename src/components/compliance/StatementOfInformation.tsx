"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, FileText, Link2 } from "lucide-react";
import { FileDropZone } from "@/components/FileDropZone";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildEvidencePath, uploadEvidenceObject } from "@/lib/storage/evidence";
import { makeStatementOfInformation, recordUploadedStatement, setStatementLink, type SoiActionState } from "@/lib/actions/soi";
import type { SoiView } from "@/lib/data/soi";
import {
  CHECKED_LABEL,
  LINK_EXPLAINER,
  MAKE_LABEL,
  SOI_AREA_MISSING,
  SOI_REPORTS,
  SOI_TYPES,
  UPLOAD_LABEL,
  reviseByLine,
  soiTypeLabel,
  versionLine,
  type SoiComparable,
} from "@/lib/rules/soi";
import { formatAuDate } from "@/lib/format-date";
import { STRATA_LAND_NOT_SHOWN } from "@/lib/rules/strata-land";

// The Statement of Information card (s72C; Reg s12H, s12I; 0121). Made in
// RealComply from the file (the main route) or uploaded, every version kept
// and listed, and the link for online ads. See lib/rules/soi.ts.

const initial: SoiActionState = { error: null };

const sydneyToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const inputClass =
  "w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm font-normal text-rc-ink focus:border-rc-green-deep focus:outline-none";
const primary =
  "rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";
const secondary =
  "rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60";

const asText = (n: number | null) => (n === null ? "" : String(n));

type Row = { address: string } & Record<Exclude<keyof SoiComparable, "address">, string>;
const rowFrom = (c: SoiComparable): Row => ({
  address: c.address,
  bedrooms: asText(c.bedrooms),
  bathrooms: asText(c.bathrooms),
  parking: asText(c.parking),
  landSizeSqm: asText(c.landSizeSqm),
  floorAreaSqm: asText(c.floorAreaSqm),
  soldPrice: c.soldPrice === null ? "" : `$${Math.round(c.soldPrice).toLocaleString("en-AU")}`,
  soldOn: c.soldOn ?? "",
  reasons: c.reasons,
});

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-1.5 text-xs text-rc-amber-deep">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

function MakeForm({ view, onClose }: { view: SoiView; onClose: () => void }) {
  const [state, action, pending] = useActionState(makeStatementOfInformation.bind(null, view.propertyId), initial);
  const [rows, setRows] = useState<Row[]>(() => view.draft.comparables.map(rowFrom));
  const set = (i: number, field: keyof Row, value: string) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  useEffect(() => {
    if (state.done) onClose();
  }, [state.done, onClose]);

  if (!view.area) {
    return (
      <div className="space-y-2">
        <ErrorLine text={SOI_AREA_MISSING} />
        <button type="button" onClick={onClose} className={secondary}>
          Back
        </button>
      </div>
    );
  }
  const fewer = rows.length < 3;

  return (
    <form action={action} className="space-y-3 rounded-md border border-rc-border bg-rc-bg-alt px-3 py-3">
      <input type="hidden" name="comparables" value={JSON.stringify(rows)} />
      <input type="hidden" name="espRevisionNo" value={view.draft.espRevisionNo} />
      <p className="text-[11px] leading-relaxed text-rc-faint">
        Filled from this listing&apos;s file onto Fair Trading&apos;s approved form. Check every detail against your records before you
        make it: what you change here goes on the statement only.
      </p>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-rc-ink">Property for sale</legend>
        <p className="text-sm text-rc-ink">{view.address}</p>
        <label className="block text-[11px] font-semibold text-rc-ink">
          Type of residential property
          <select name="propertyType" defaultValue={view.draft.propertyType ?? ""} required className={`mt-1 ${inputClass}`}>
            <option value="" disabled>
              Choose one
            </option>
            {SOI_TYPES.map((t) => (
              <option key={t} value={t}>
                {soiTypeLabel(t)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11px] text-rc-muted">
          {view.area === "metro"
            ? "In a metropolitan area: comparable properties sold within 2 km, in the last 6 months, or 12 if fewer than 3 sold in 6."
            : "Outside a metropolitan area: comparable properties sold within 5 km in the last 18 months."}{" "}
          From the council area on this listing.
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold text-rc-ink">Section A: the 3 most comparable properties</legend>
        <p className="text-[11px] text-rc-faint">
          From {view.draft.from}. To change which properties these are, change the most comparable there first.
        </p>
        {rows.length === 0 && (
          <p className="text-[11px] italic text-rc-faint">No properties are marked as the most comparable, so the statement has Section B only.</p>
        )}
        {rows.map((r, i) => (
          <div key={r.address} className="space-y-1.5 rounded-md border border-rc-border bg-white px-2.5 py-2">
            <p className="text-[13px] font-semibold text-rc-ink">
              Property {i + 1}: {r.address}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["bedrooms", "Bedrooms"],
                  ["bathrooms", "Bathrooms"],
                  ["parking", "Parking spaces"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="text-[11px] text-rc-muted">
                  {label}
                  <input inputMode="numeric" value={r[field]} onChange={(e) => set(i, field, e.target.value)} className={inputClass} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-rc-muted">
                Land size, m² (if known)
                <input inputMode="decimal" value={r.landSizeSqm} onChange={(e) => set(i, "landSizeSqm", e.target.value)} className={inputClass} />
                {/* Over 500 m² on a strata listing: left out, and said why (lib/rules/strata-land.ts). */}
                {!r.landSizeSqm.trim() && view.draft.landNotShown.includes(r.address) && (
                  <span className="mt-0.5 block text-[10px] text-rc-faint">{STRATA_LAND_NOT_SHOWN}</span>
                )}
              </label>
              <label className="text-[11px] text-rc-muted">
                Floor area, m² (if known)
                <input inputMode="decimal" value={r.floorAreaSqm} onChange={(e) => set(i, "floorAreaSqm", e.target.value)} className={inputClass} />
              </label>
              <label className="text-[11px] text-rc-muted">
                Sold price
                <input inputMode="decimal" value={r.soldPrice} onChange={(e) => set(i, "soldPrice", e.target.value)} className={inputClass} />
              </label>
              <label className="text-[11px] text-rc-muted">
                Date of sale
                <input type="date" value={r.soldOn} onChange={(e) => set(i, "soldOn", e.target.value)} className={inputClass} />
              </label>
            </div>
            <label className="block text-[11px] text-rc-muted">
              Reasons why this is a comparable property (for example location, features, condition)
              <textarea rows={2} value={r.reasons} onChange={(e) => set(i, "reasons", e.target.value)} className={inputClass} />
            </label>
          </div>
        ))}
      </fieldset>

      {fewer && (
        <label className="block text-xs font-semibold text-rc-ink">
          Section B: why there are fewer than 3 comparable properties
          <textarea name="fewerReason" rows={2} defaultValue={view.draft.fewerReason} className={`mt-1 ${inputClass}`} />
        </label>
      )}

      <fieldset>
        <legend className="text-xs font-semibold text-rc-ink">Property reports and documents you were aware of when it was first prepared</legend>
        <div className="mt-1 space-y-1">
          {SOI_REPORTS.map((r) => (
            <label key={r.key} className="flex items-start gap-1.5 text-[12px] leading-snug text-rc-ink">
              <input
                type="checkbox"
                name="reports"
                value={r.key}
                defaultChecked={view.draft.reports.includes(r.key)}
                className="mt-0.5 shrink-0 accent-rc-green-deep"
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        {view.draft.reportHints.map((h) => (
          <p key={h} className="mt-1 text-[11px] text-rc-muted">
            {h}
          </p>
        ))}
      </fieldset>

      <p className="text-[11px] text-rc-muted">
        Prepared on {formatAuDate(sydneyToday())} by {view.preparedBy}.
      </p>
      <label className="flex items-start gap-1.5 text-xs font-semibold text-rc-ink">
        <input type="checkbox" name="checked" className="mt-0.5 shrink-0 accent-rc-green-deep" />
        {CHECKED_LABEL}
      </label>
      <ErrorLine text={state.error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? "Making it..." : "Make the statement"}
        </button>
        <button type="button" onClick={onClose} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function UploadForm({ view, onClose }: { view: SoiView; onClose: () => void }) {
  const [state, action, pending] = useActionState(recordUploadedStatement.bind(null, view.propertyId), initial);
  const [file, setFile] = useState<File | null>(null);
  const [stored, setStored] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = view.revisionNos.length > 0 ? Math.max(...view.revisionNos) : 0;
  useEffect(() => {
    if (state.done) onClose();
  }, [state.done, onClose]);

  async function choose(f: File | null) {
    setFile(f);
    setStored(null);
    setProblem(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setProblem("Upload the statement as a PDF, so buyers can open it from the link.");
      return;
    }
    setUploading(true);
    const path = buildEvidencePath(view.agencyId, view.propertyId, "soi", f.name);
    const { error, file: kept } = await uploadEvidenceObject(createBrowserClient(), { path, file: f });
    setUploading(false);
    if (error) setProblem(error);
    else setStored({ path, name: kept.name });
  }

  return (
    <form action={action} className="space-y-3 rounded-md border border-rc-border bg-rc-bg-alt px-3 py-3">
      <input type="hidden" name="path" value={stored?.path ?? ""} />
      <input type="hidden" name="fileName" value={stored?.name ?? ""} />
      <p className="text-[11px] leading-relaxed text-rc-faint">
        A statement made elsewhere, for example on your CRM, on Fair Trading&apos;s approved form. It&apos;s kept as the next version, as it is.
      </p>
      <FileDropZone file={file} onFile={choose} disabled={uploading || pending} label="Drag the PDF here, or click to browse" compact />
      {uploading && <p className="text-[11px] text-rc-muted">Uploading...</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-rc-ink">
          Date it was prepared
          <input type="date" name="preparedOn" defaultValue={sydneyToday()} max={sydneyToday()} required className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-[11px] font-semibold text-rc-ink">
          The ESP it&apos;s for
          <select name="espRevisionNo" defaultValue={String(latest)} className={`mt-1 ${inputClass}`}>
            <option value="0">The agreement&apos;s ESP</option>
            {view.revisionNos.map((n) => (
              <option key={n} value={n}>
                ESP revision {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorLine text={problem ?? state.error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending || uploading || !stored} className={primary}>
          {pending ? "Saving..." : "Save the statement"}
        </button>
        <button type="button" onClick={onClose} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function LinkPart({ view }: { view: SoiView }) {
  const [state, action, pending] = useActionState(setStatementLink.bind(null, view.propertyId), initial);
  const [copied, setCopied] = useState(false);
  const live = view.link?.enabled && !view.linkStopped;
  const changed = view.link?.changedAt
    ? ` Switched ${view.link.enabled ? "on" : "off"} ${formatAuDate(
        new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(view.link.changedAt)),
      )}${view.link.changedByName ? ` by ${view.link.changedByName}` : ""}.`
    : "";

  return (
    <div className="space-y-2 rounded-md border border-rc-border px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-rc-ink">
        <Link2 size={13} aria-hidden="true" />
        Link for online ads
      </p>
      <p className="text-[11px] leading-relaxed text-rc-faint">{LINK_EXPLAINER}</p>
      {live && view.linkUrl && (
        <div className="flex items-center gap-2">
          <input readOnly value={view.linkUrl} aria-label="Link to the statement" className={`${inputClass} text-xs`} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className={`${secondary} inline-flex shrink-0 items-center gap-1`}
            onClick={async () => {
              await navigator.clipboard.writeText(view.linkUrl as string);
              setCopied(true);
            }}
          >
            <Copy size={11} aria-hidden="true" />
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={view.linkUrl} target="_blank" rel="noreferrer" className={`${secondary} inline-flex shrink-0 items-center gap-1`}>
            <ExternalLink size={11} aria-hidden="true" />
            Open
          </a>
        </div>
      )}
      {view.link && view.linkStopped && <p className="text-[11px] font-semibold text-rc-amber-deep">{view.linkStopped}</p>}
      {changed && <p className="text-[11px] text-rc-muted">{changed.trim()}</p>}
      <ErrorLine text={state.error} />
      {!view.readOnly && (
        <form action={action}>
          <input type="hidden" name="on" value={view.link?.enabled ? "false" : "true"} />
          <button type="submit" disabled={pending} className={view.link?.enabled ? secondary : primary}>
            {view.link?.enabled ? "Switch the link off" : "Switch the link on"}
          </button>
        </form>
      )}
    </div>
  );
}

export function StatementOfInformationBody({ view }: { view: SoiView }) {
  const [open, setOpen] = useState<"make" | "upload" | null>(null);
  const [current, ...earlier] = view.versions;
  const close = () => setOpen(null);

  return (
    <div className="space-y-3">
      {view.reviseBy && (
        <p className="flex items-start gap-1.5 rounded-lg bg-rc-amber/10 px-2.5 py-1.5 text-xs font-semibold text-rc-amber-deep">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {reviseByLine(view.reviseBy)}
        </p>
      )}

      {current ? (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rc-faint">Current statement</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-rc-ink">
            <FileText size={14} className="shrink-0 text-rc-green-deep" aria-hidden="true" />
            <span>{versionLine(current)}</span>
            {current.url && (
              <a href={current.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-rc-green-deep underline">
                View
              </a>
            )}
          </p>
          {earlier.length > 0 && (
            <details className="text-xs text-rc-muted">
              <summary className="cursor-pointer font-semibold">Earlier versions ({earlier.length}), kept for 3 years</summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {earlier.map((v) => (
                  <li key={v.versionNo}>
                    {versionLine(v)}
                    {v.url && (
                      <>
                        {" "}
                        <a href={v.url} target="_blank" rel="noreferrer" className="font-semibold text-rc-green-deep underline">
                          View
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="text-sm text-rc-muted">No statement on this listing yet. Make it from this listing&apos;s file, or upload one made elsewhere.</p>
      )}

      {!view.readOnly && open === null && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setOpen("make")} className={primary}>
            {current ? "Make a revised one in RealComply" : MAKE_LABEL}
          </button>
          <button type="button" onClick={() => setOpen("upload")} className={secondary}>
            {current ? "Upload a revised one" : UPLOAD_LABEL}
          </button>
        </div>
      )}
      {open === "make" && <MakeForm view={view} onClose={close} />}
      {open === "upload" && <UploadForm view={view} onClose={close} />}

      {current && <LinkPart view={view} />}
    </div>
  );
}
