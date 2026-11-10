"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { discardSgDocument, saveSgDocument } from "@/lib/actions/sg-document";
import { sgCheckLines, sgReadGapLines, type SgChecks } from "@/lib/sg-document/checks";
import { SG_DOC_TYPES, type SgDocType } from "@/lib/sg-document/fair-trading";
import { sectionHeading } from "@/lib/sg-document/sections";
import type { SgSectionView } from "@/lib/data/sg-document";
import { compareVersions } from "@/lib/sg-document/compare";
import type { SgAmendment } from "@/lib/sg-document/amendments";
import { SgCompareVersions } from "@/components/sg/SgCompareVersions";

// A document read into sections, waiting to be checked (Adam's mockup, 6 Nov
// 2026, screen 1; Master, 10 Nov 2026, for the manuals already on file). The
// licensee in charge or an office manager looks at the 2.1.3 flags, picks
// exactly one kind of document, confirms the version number and saves it as
// the live document. Until then the current file stays exactly as it is.
export function SgDraftReview({
  id,
  fileName,
  fromFileOnRecord,
  versionRead,
  checks,
  sections,
  live = null,
}: {
  id: string;
  fileName: string;
  fromFileOnRecord: boolean;
  versionRead: string | null;
  checks: SgChecks | null;
  sections: SgSectionView[];
  /**
   * The live document and its approved amendments, to compare a new full
   * version with (Adam's mockup, screen 4; part 3). Null for the first one.
   */
  live?: { versionLabel: string | null; sections: SgSectionView[]; amendments: SgAmendment[] } | null;
}) {
  const router = useRouter();
  const [docType, setDocType] = useState<SgDocType | null>(null);
  const [version, setVersion] = useState(versionRead ?? "");
  const [busy, setBusy] = useState<"save" | "discard" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = checks ? sgCheckLines(checks) : [];
  const gaps = sgReadGapLines(checks);
  const paragraphs = sections.reduce((n, s) => n + s.paragraphs.length, 0);
  const comparison = useMemo(
    () => (live ? compareVersions(live.sections, live.amendments, sections, live.versionLabel) : null),
    [live, sections],
  );

  async function save() {
    if (!docType) {
      setError("Choose what kind of document this is.");
      return;
    }
    if (!version.trim()) {
      setError("Confirm the version number.");
      return;
    }
    setError(null);
    setBusy("save");
    const r = await saveSgDocument(id, docType, version);
    setBusy(null);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  async function discard() {
    setBusy("discard");
    const r = await discardSgDocument(id);
    setBusy(null);
    setConfirmDiscard(false);
    if (r.error) setError(r.error);
    else router.refresh();
  }

  return (
    <section className="rounded-card border border-rc-border bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-rc-ink">Check and save your document</h2>
        <span className="rounded-full border border-rc-amber-deep/25 bg-rc-amber/10 px-2.5 py-0.5 text-xs font-semibold text-rc-amber-deep">
          Draft
        </span>
      </div>
      <p className="mt-1 max-w-prose text-sm text-rc-muted">
        {fromFileOnRecord ? (
          <>
            RealComply has read your manual on file, <span className="font-medium text-rc-ink">{fileName}</span>, into{" "}
            {sections.length} sections.
          </>
        ) : (
          <>
            RealComply has read <span className="font-medium text-rc-ink">{fileName}</span> into {sections.length} sections.
          </>
        )}{" "}
        Check it, pick what kind of document it is and confirm the version number, then save it as your live document.
        Until you save it, your current file stays as it is.
      </p>

      {/* What couldn't be read (Adam, 10 Nov 2026): named, so the office
          checks those pages by hand. Never hidden, and saving isn't blocked. */}
      {gaps.length > 0 && (
        <div role="note" className="mt-4 rounded-xl border border-rc-amber-deep/25 bg-rc-amber/10 px-3.5 py-2.5 text-sm text-rc-ink">
          <p className="font-semibold text-rc-amber-deep">Not everything could be read</p>
          {gaps.map((g) => (
            <p key={g} className="mt-0.5">
              {g}
            </p>
          ))}
        </div>
      )}

      {comparison && live && <SgCompareVersions comparison={comparison} liveLabel={live.versionLabel} newLabel={version} />}

      {lines.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-rc-ink">Checked against Fair Trading&rsquo;s Supervision Guidelines (2.1.3)</h3>
          <ul className="mt-2 divide-y divide-rc-border overflow-hidden rounded-xl border border-rc-border">
            {lines.map((l) => (
              <li key={l.text} className="flex gap-3 px-3.5 py-2.5 text-sm">
                <span
                  className={`h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    l.ok ? "bg-rc-green-soft text-rc-green-deep" : "bg-red-100 text-red-700"
                  }`}
                >
                  {l.ok ? "Found" : "Check"}
                </span>
                <span className="min-w-0">
                  <span className="text-rc-ink">{l.text}</span>
                  {l.detail && <span className="mt-0.5 block text-xs text-rc-muted">{l.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-rc-muted">These are flags for you to look at. Saving isn&rsquo;t blocked.</p>
        </div>
      )}

      <fieldset className="mt-5">
        <legend className="text-sm font-semibold text-rc-ink">What is this document? (choose one)</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(Object.keys(SG_DOC_TYPES) as SgDocType[]).map((t) => (
            <label
              key={t}
              className={`cursor-pointer rounded-full border-[1.5px] px-4 py-1.5 text-sm font-semibold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-rc-green-deep ${
                docType === t ? "border-rc-green-deep bg-rc-green-deep text-white" : "border-rc-border bg-white text-rc-ink hover:border-rc-green-deep"
              }`}
            >
              <input type="radio" name={`sg-type-${id}`} value={t} checked={docType === t} onChange={() => setDocType(t)} className="sr-only" />
              {SG_DOC_TYPES[t]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={`sg-version-${id}`} className="text-sm font-semibold text-rc-ink">
          Your version number
        </label>
        <input
          id={`sg-version-${id}`}
          type="text"
          value={version}
          maxLength={40}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="e.g. v7.3"
          className="mt-1 block w-48 rounded-lg border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
        />
        <p className="mt-1 text-xs text-rc-muted">
          {versionRead ? "Read from the document. Change it if it's wrong." : "No version number was found in the document. Type the one you use."}
        </p>
      </div>

      <details className="mt-5 rounded-xl border border-rc-border">
        <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-rc-ink">
          The sections read ({sections.length} sections, {paragraphs} paragraphs)
        </summary>
        <ol className="divide-y divide-rc-border border-t border-rc-border">
          {sections.map((s) => (
            <li key={s.position}>
              <details>
                <summary className="flex cursor-pointer justify-between gap-3 px-3.5 py-2 text-sm text-rc-ink">
                  <span className="min-w-0 break-words">{sectionHeading(s)}</span>
                  <span className="shrink-0 text-xs text-rc-muted">
                    {s.paragraphs.length} {s.paragraphs.length === 1 ? "paragraph" : "paragraphs"}
                  </span>
                </summary>
                <div className="space-y-2 bg-rc-bg-alt px-3.5 py-3 text-sm leading-relaxed text-rc-ink">
                  {s.paragraphs.map((p, i) => (
                    <p key={i} className="whitespace-pre-line break-words">
                      {p}
                    </p>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ol>
      </details>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy !== null}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {busy === "save" ? "Saving…" : live ? `Approve ${version.trim() || "this version"} as current` : "Save as current document"}
        </button>
        {!confirmDiscard ? (
          <button type="button" onClick={() => setConfirmDiscard(true)} className="text-sm font-medium text-rc-muted hover:text-rc-amber-deep">
            Throw this draft away
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-rc-ink">Throw this draft away? The file stays where it is.</span>
            <button type="button" onClick={discard} disabled={busy !== null} className="font-semibold text-rc-amber-deep">
              {busy === "discard" ? "Throwing away…" : "Yes, throw it away"}
            </button>
            <button type="button" onClick={() => setConfirmDiscard(false)} className="text-rc-muted">
              Keep it
            </button>
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rc-amber-deep">
          {error}
        </p>
      )}
    </section>
  );
}
