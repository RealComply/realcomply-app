"use client";

import { useActionState, useMemo, useState } from "react";
import { signPackInApp, type PackActionState } from "@/lib/actions/licensee-signoff";
import {
  GROUP_HEADINGS,
  GROUP_ORDER,
  GROUP_TILES,
  PACK_TICK,
  signButton,
  signsLine,
  type Group,
} from "@/lib/licensee-signoff/model";

// The licensee reviews and signs the month's pack (Adam, 3 Nov 2026; the
// approved mockup, view 3), in the app, logged in. Flagged items first;
// everything else by group, folded; any item can be held back with a short
// note; one tick, then "Sign [n] items".

export type ReviewItem = {
  id: string;
  group: Group;
  title: string;
  details: string;
  flagged: boolean;
  flagText: string | null;
  note: string | null;
  noteBy: string | null;
  /** Where it opens: the file's audit pack or the document. Null when everything is on this page. */
  openHref: string | null;
  openLabel: string;
};

export function PackReview({
  packId,
  monthLabel,
  sentLine,
  pdfHref,
  items,
  licenseeName,
  todayLabel,
}: {
  packId: string;
  monthLabel: string;
  sentLine: string | null;
  pdfHref: string;
  items: ReviewItem[];
  licenseeName: string;
  todayLabel: string;
}) {
  const [state, formAction, pending] = useActionState<PackActionState, FormData>(signPackInApp, { error: null });
  const [held, setHeld] = useState<Record<string, string>>({});
  const [holding, setHolding] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [ticked, setTicked] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Group, number> = { sales: 0, pm: 0, trust: 0, office: 0 };
    for (const i of items) c[i.group] += 1;
    return c;
  }, [items]);
  const flagged = items.filter((i) => i.flagged && !(i.id in held));
  const rest = items.filter((i) => !i.flagged && !(i.id in held));
  const heldItems = items.filter((i) => i.id in held);
  const toSign = items.length - heldItems.length;
  const signerName = licenseeName;

  if (state.done) {
    return (
      <section className="rounded-card border border-rc-green-deep/30 bg-white p-5 shadow-card">
        <h2 className="text-lg font-bold text-rc-ink">{monthLabel} pack signed</h2>
        <p className="mt-1 text-sm text-rc-muted">
          {toSign} {toSign === 1 ? "item" : "items"} signed by {signerName} on {todayLabel}. {heldItems.length} held back.
        </p>
      </section>
    );
  }

  const row = (i: ReviewItem) => (
    <li
      key={i.id}
      className={`rounded-xl border px-3 py-2.5 ${i.flagged ? "border-rc-amber/40 bg-rc-amber/10" : "border-rc-border bg-rc-bg-alt"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rc-ink">
            {i.title}
            {i.flagText && (
              <span className="ml-2 rounded-full border border-rc-amber/40 bg-rc-amber/10 px-2 py-0.5 text-[11px] font-bold text-rc-amber-deep">
                {i.flagText.split(":")[0]}
              </span>
            )}
          </p>
          <p className="text-xs text-rc-muted">{i.details}</p>
          {i.flagText && i.flagText.includes(":") && <p className="text-xs text-rc-amber-deep">{i.flagText.split(":").slice(1).join(":").trim()}</p>}
          {i.note && (
            <p className="mt-1 rounded border-l-[3px] border-rc-green-deep bg-white px-2 py-1 text-xs text-rc-ink">
              {i.noteBy ? `${i.noteBy}: ` : ""}
              {i.note}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm font-semibold">
          {i.openHref && (
            <a href={i.openHref} target="_blank" rel="noreferrer" className="text-rc-green-deep hover:underline">
              {i.openLabel}
            </a>
          )}
          <button
            type="button"
            onClick={() => {
              setHolding(i.id);
              setDraftNote("");
            }}
            className="text-rc-green-deep hover:underline"
          >
            Hold back
          </button>
        </div>
      </div>
      {holding === i.id && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`hold-${i.id}`}>
            Why hold it back?
          </label>
          <input
            id={`hold-${i.id}`}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            maxLength={500}
            placeholder="A short note for the office"
            className="min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={!draftNote.trim()}
            onClick={() => {
              setHeld((h) => ({ ...h, [i.id]: draftNote.trim() }));
              setHolding(null);
            }}
            className="rounded-full bg-rc-amber-deep px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Hold back
          </button>
          <button type="button" onClick={() => setHolding(null)} className="text-xs text-rc-muted underline">
            Cancel
          </button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{monthLabel} sign-off pack</h1>
          {sentLine && <p className="mt-1 text-sm text-rc-muted">{sentLine}</p>}
        </div>
        <a
          href={pdfHref}
          className="inline-flex min-h-10 items-center rounded-lg border border-rc-border bg-white px-4 text-sm font-semibold text-rc-ink hover:border-rc-ink/30"
        >
          Download pack (PDF)
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="rounded-xl border border-rc-border bg-rc-bg-alt px-3 py-2.5">
            <p className="text-xl font-bold tabular-nums text-rc-ink">{counts[g]}</p>
            <p className="text-xs text-rc-muted">{GROUP_TILES[g]}</p>
          </div>
        ))}
      </div>

      <form action={formAction} className="space-y-4 rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-5">
        <input type="hidden" name="packId" value={packId} />
        <input type="hidden" name="holds" value={JSON.stringify(Object.entries(held).map(([id, note]) => ({ id, note })))} />

        {flagged.length > 0 && (
          <section>
            <h2 className="flex justify-between text-xs font-bold uppercase tracking-wide text-rc-muted">
              <span>Flagged: take a closer look</span>
              <span>{flagged.length}</span>
            </h2>
            <ul className="mt-2 space-y-1.5">{flagged.map(row)}</ul>
          </section>
        )}

        <section>
          <h2 className="flex justify-between text-xs font-bold uppercase tracking-wide text-rc-muted">
            <span>Everything else</span>
            <span>{rest.length}</span>
          </h2>
          <ul className="mt-2 space-y-1.5">
            {GROUP_ORDER.map((g) => {
              const list = rest.filter((i) => i.group === g);
              if (list.length === 0) return null;
              return (
                <li key={g} className="rounded-xl border border-rc-border bg-rc-bg-alt px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-rc-ink">{GROUP_TILES[g]}</p>
                      <p className="text-xs text-rc-muted">
                        {list.length} {list.length === 1 ? "item" : "items"}, no flags
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [g]: !o[g] }))}
                      aria-expanded={Boolean(open[g])}
                      className="text-sm font-semibold text-rc-green-deep hover:underline"
                    >
                      {open[g] ? "Hide list" : "Show list"}
                    </button>
                  </div>
                  {open[g] && (
                    <ul className="mt-2 space-y-1.5" aria-label={GROUP_HEADINGS[g]}>
                      {list.map(row)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {heldItems.length > 0 && (
          <section className="space-y-1.5 rounded-xl border border-dashed border-rc-amber/50 bg-rc-amber/10 px-3 py-2.5 text-sm">
            <p className="font-semibold text-rc-ink">Held back: {heldItems.length}.</p>
            {heldItems.map((i) => (
              <p key={i.id} className="text-rc-ink">
                {i.title}. &ldquo;{held[i.id]}&rdquo; Goes back to the office and into next month&apos;s pack.{" "}
                <button
                  type="button"
                  onClick={() =>
                    setHeld((h) => {
                      const next = { ...h };
                      delete next[i.id];
                      return next;
                    })
                  }
                  className="font-semibold text-rc-green-deep underline"
                >
                  Undo
                </button>
              </p>
            ))}
          </section>
        )}

        <label className="flex items-start gap-2.5 rounded-xl border-[1.5px] border-rc-green-deep bg-rc-green-soft px-3.5 py-3 text-sm font-semibold text-rc-ink">
          <input
            type="checkbox"
            name="reviewed"
            value="yes"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>{PACK_TICK}</span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-rc-muted">{signsLine(toSign, signerName, todayLabel)}</p>
          <button
            type="submit"
            disabled={!ticked || pending || toSign === 0}
            className="inline-flex min-h-10 items-center rounded-lg bg-rc-green-deep px-5 text-sm font-semibold text-white disabled:opacity-45"
          >
            {pending ? "Signing…" : signButton(toSign)}
          </button>
        </div>
        {state.error && (
          <p role="alert" className="text-sm text-rc-amber-deep">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
