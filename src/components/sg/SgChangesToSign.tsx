"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { signSgAmendment } from "@/lib/actions/sg-amendments";
import { changeHeadline, type SgAmendment } from "@/lib/sg-document/amendments";
import { SgDiff } from "@/components/sg/SgDiff";

// Staff sign-off of each change (Adam's mockup, screen 6; 0125): on Home, a
// short card for each change to the supervision guidelines the person hasn't
// signed yet, with exactly what changed. They sign the change, not the whole
// document. The card goes once they have.

export const SIGN_CHANGE = "I've read and understood this change";

export function SgChangesToSign({ changes }: { changes: SgAmendment[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="mt-4 space-y-3">
      {changes.map((c) => (
        <ChangeCard key={c.id} change={c} />
      ))}
    </div>
  );
}

function ChangeCard({ change }: { change: SgAmendment }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  return (
    <section className="max-w-2xl rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-rc-ink">Supervision guidelines changed</h2>
        <span className="rounded-full border border-rc-amber-deep/30 bg-rc-amber/10 px-2.5 py-0.5 text-[11px] font-bold text-rc-amber-deep">
          To sign
        </span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-rc-ink">{changeHeadline(change)}</p>
      <div className="mt-2">
        <SgDiff before={change.previousText} after={change.newText} />
      </div>
      <Link
        href={`/dashboard/sg-manual#sg-section-${change.sectionPosition}`}
        className="mt-2 inline-block text-sm font-semibold text-rc-green-deep hover:underline"
      >
        Read the full section
      </Link>
      {error && <p className="mt-2 text-sm font-semibold text-rc-red">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await signSgAmendment(change.id);
              if (res.error) setError(res.error);
            });
          }}
          className="rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : SIGN_CHANGE}
        </button>
        <span className="text-xs text-rc-muted">This card goes once you&apos;ve signed.</span>
      </div>
    </section>
  );
}
