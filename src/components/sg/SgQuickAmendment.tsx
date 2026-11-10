"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { SgDiff } from "@/components/sg/SgDiff";
import { discardSgAmendment, saveSgAmendment } from "@/lib/actions/sg-amendments";
import {
  SG_AMENDMENT_REASONS,
  amendmentRef,
  currentWording,
  isSgAmendmentReason,
  paragraphCount,
  type SgAmendment,
  type SgAmendmentReason,
} from "@/lib/sg-document/amendments";
import { sectionHeading } from "@/lib/sg-document/sections";
import { formatAuDate } from "@/lib/format-date";
import type { SgSectionView } from "@/lib/data/sg-document";

// Quick amendment (Adam's mockup, screen 3; 0125). Pick the section and the
// paragraph, change the wording (it starts as the current wording), see the
// before and after, say why and when it starts, then approve it or keep it
// as a draft. Approving asks every staff member to sign it and moves the next
// review to 12 months from today. For whoever runs the office.

export const APPROVAL_NOTE =
  "the licensee in charge or an office manager approves this. Once approved, every staff member is asked to sign it, and the next review date moves to 12 months from today.";

type Draft = { id: string | null; section: number; paragraph: number; text: string; reason: SgAmendmentReason | ""; other: string; starts: string };

export function SgQuickAmendment({
  documentId,
  sections,
  amendments,
  today,
}: {
  documentId: string;
  sections: SgSectionView[];
  /** The live document's amendments: approved, and drafts. */
  amendments: SgAmendment[];
  /** Today in Sydney, YYYY-MM-DD. */
  today: string;
}) {
  const drafts = amendments.filter((a) => a.status === "draft");
  const [form, setForm] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const section = sections.find((s) => s.position === form?.section) ?? null;
  const count = section ? paragraphCount(section, amendments) : 0;
  const before = useMemo(
    () => (form ? currentWording(sections, amendments, form.section, form.paragraph) : ""),
    [form, sections, amendments],
  );

  const start = (sectionPosition: number) => {
    const s = sections.find((x) => x.position === sectionPosition);
    const text = s ? currentWording(sections, amendments, sectionPosition, 0) : "";
    setError(null);
    setForm({ id: null, section: sectionPosition, paragraph: 0, text, reason: "", other: "", starts: today });
  };

  const openDraft = (a: SgAmendment) => {
    setError(null);
    setForm({
      id: a.id,
      section: a.sectionPosition,
      paragraph: a.paragraphIndex,
      text: a.newText,
      reason: a.reason,
      other: a.reasonOther ?? "",
      starts: a.startsOn,
    });
  };

  const save = (approve: boolean) => {
    if (!form) return;
    if (!form.reason) {
      setError("Choose the reason.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveSgAmendment({
        id: form.id,
        documentId,
        sectionPosition: form.section,
        paragraphIndex: form.paragraph,
        newText: form.text,
        reason: form.reason,
        reasonOther: form.other,
        startsOn: form.starts,
        approve,
      });
      if (res.error) setError(res.error);
      else setForm(null);
    });
  };

  const discard = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await discardSgAmendment(id);
      if (res.error) setError(res.error);
      else if (form?.id === id) setForm(null);
    });
  };

  if (!form) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => start(sections[0]?.position ?? 0)}
          disabled={sections.length === 0}
          className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <Pencil size={14} aria-hidden="true" /> Quick amendment
        </button>
        {drafts.length > 0 && (
          <div className="rounded-xl border border-rc-amber-deep/25 bg-rc-amber/10 px-3.5 py-2.5 text-sm">
            <p className="font-semibold text-rc-amber-deep">Draft amendments, not approved yet</p>
            <ul className="mt-1 space-y-1">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-rc-ink">
                  <span className="min-w-0 break-words">
                    {d.sectionLabel}, from {formatAuDate(d.startsOn)}
                    {d.createdByName ? `, drafted by ${d.createdByName}` : ""}
                  </span>
                  <span className="flex shrink-0 gap-3 text-xs font-semibold">
                    <button type="button" onClick={() => openDraft(d)} className="text-rc-green-deep hover:underline">
                      Open
                    </button>
                    <button type="button" disabled={busy} onClick={() => discard(d.id)} className="text-rc-muted hover:underline">
                      Throw away
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm font-semibold text-rc-red">{error}</p>}
      </div>
    );
  }

  const paragraphLabel = (k: number) => {
    if (k >= count) return "Add a new paragraph at the end";
    const text = currentWording(sections, amendments, form.section, k).replace(/\s+/g, " ").trim();
    return text.length > 90 ? `${text.slice(0, 88)}…` : text || `Paragraph ${k + 1}`;
  };

  return (
    <div className="space-y-3 rounded-card border border-rc-border bg-white p-4 shadow-card">
      <h3 className="text-base font-semibold text-rc-ink">{form.id ? "Draft amendment" : "Quick amendment"}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="font-semibold text-rc-ink">Section</span>
          <select
            value={form.section}
            onChange={(e) => {
              const pos = Number(e.target.value);
              setForm({ ...form, section: pos, paragraph: 0, text: currentWording(sections, amendments, pos, 0) });
            }}
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
          >
            {sections.map((s) => (
              <option key={s.position} value={s.position}>
                {sectionHeading(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-rc-ink">Paragraph</span>
          <select
            value={form.paragraph}
            onChange={(e) => {
              const k = Number(e.target.value);
              setForm({ ...form, paragraph: k, text: currentWording(sections, amendments, form.section, k) });
            }}
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
          >
            {Array.from({ length: count + 1 }, (_, k) => (
              <option key={k} value={k}>
                {paragraphLabel(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-sm">
        <span className="font-semibold text-rc-ink">New wording</span>
        <textarea
          value={form.text}
          onChange={(e) => setForm({ ...form, text: e.target.value })}
          rows={5}
          maxLength={20000}
          className="mt-1 w-full rounded-md border border-rc-border px-2.5 py-2 text-sm leading-relaxed"
        />
        <span className="text-xs text-rc-muted">Starts filled in with the current wording.</span>
      </label>
      <SgDiff before={before} after={form.text} />
      <fieldset>
        <legend className="text-sm font-semibold text-rc-ink">Reason</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {(Object.keys(SG_AMENDMENT_REASONS) as SgAmendmentReason[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={form.reason === r}
              onClick={() => setForm({ ...form, reason: isSgAmendmentReason(r) ? r : "" })}
              className={`rounded-full border px-3.5 py-1 text-sm font-semibold transition ${
                form.reason === r ? "border-rc-green-deep bg-rc-green-deep text-white" : "border-rc-border bg-white text-rc-ink hover:border-rc-green-deep"
              }`}
            >
              {SG_AMENDMENT_REASONS[r]}
            </button>
          ))}
        </div>
        {form.reason === "other" && (
          <input
            type="text"
            value={form.other}
            onChange={(e) => setForm({ ...form, other: e.target.value })}
            maxLength={200}
            placeholder="What's the reason?"
            aria-label="The other reason"
            className="mt-2 w-full max-w-md rounded-md border border-rc-border px-2.5 py-1.5 text-sm"
          />
        )}
      </fieldset>
      <label className="block text-sm">
        <span className="font-semibold text-rc-ink">Starts</span>
        <input
          type="date"
          value={form.starts}
          onChange={(e) => setForm({ ...form, starts: e.target.value })}
          className="mt-1 block rounded-md border border-rc-border px-2 py-1.5 text-sm"
        />
      </label>
      <p className="rounded-lg border border-rc-amber-deep/25 bg-rc-amber/10 px-3 py-2 text-sm text-rc-ink">
        <span className="font-semibold text-rc-amber-deep">Approval:</span> {APPROVAL_NOTE}
      </p>
      {error && <p className="text-sm font-semibold text-rc-red">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => save(true)}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : "Approve amendment"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => save(false)}
          className="rounded-full border border-rc-border bg-white px-4 py-2 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:opacity-60"
        >
          Save as draft
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setForm(null);
            setError(null);
          }}
          className="rounded-full px-3 py-2 text-sm font-medium text-rc-muted hover:underline"
        >
          Cancel
        </button>
      </div>
      {amendments.some((a) => a.status === "approved") && (
        <p className="text-xs text-rc-faint">
          Approved so far on this version: {amendments.filter((a) => a.status === "approved").map(amendmentRef).join(", ")}.
        </p>
      )}
    </div>
  );
}
