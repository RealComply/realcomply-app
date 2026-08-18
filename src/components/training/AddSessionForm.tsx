"use client";

import { useActionState, useState } from "react";
import { addTrainingSession, type ActionState } from "@/lib/actions/registers";

const initialState: ActionState = { error: null };

export function AddSessionForm() {
  const [state, formAction, pending] = useActionState(addTrainingSession, initialState);
  const [cpdEligible, setCpdEligible] = useState(false);

  return (
    <form action={formAction} className="space-y-3 rounded-card border border-dashed border-rc-border bg-rc-bg-alt p-5">
      <h3 className="text-sm font-semibold text-rc-ink">Log a training session</h3>
      <input
        type="text"
        name="title"
        placeholder="Session title (e.g. 'Underquoting refresher')"
        required
        className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="block text-xs text-rc-muted">Date</label>
          <input type="date" name="sessionDate" required className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-rc-muted">Trainer</label>
          <input
            type="text"
            name="trainerName"
            placeholder="Name"
            className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
          />
        </div>
        <label className="mt-5 flex items-center gap-1.5 text-xs text-rc-muted">
          <input type="checkbox" name="isExternal" />
          External trainer
        </label>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-rc-muted">
        <input type="checkbox" name="isCpdEligible" checked={cpdEligible} onChange={(e) => setCpdEligible(e.target.checked)} />
        Delivered by a Fair Trading approved provider (counts toward CPD)
      </label>

      {/* Said plainly, because the wrong answer here silently tells someone
          they've met a condition of their licence when they haven't. The test
          is the provider and the topic, not where it was held — which is the
          part people get backwards in both directions. */}
      {cpdEligible ? (
        <div className="space-y-3 rounded-md border border-rc-border bg-white px-3 py-2">
          <p className="text-[11px] leading-relaxed text-rc-muted">
            Only Fair Trading approved providers can deliver CPD, and every published hour this year is a compulsory
            topic. Your own internal sessions don&rsquo;t count — but an approved provider delivering at your office
            does, so the venue isn&rsquo;t the test.
          </p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="block text-xs text-rc-muted">Approved provider</label>
              <input
                type="text"
                name="cpdProvider"
                placeholder="e.g. REINSW"
                className="mt-1 w-48 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-rc-muted">CPD hours per attendee</label>
              <input
                type="number"
                step="0.5"
                min="0"
                name="cpdHours"
                className="mt-1 w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-rc-faint">
            Keep each attendee&rsquo;s record of completion from the provider — that&rsquo;s the evidence, and it should
            arrive within 10 business days.
          </p>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-rc-faint">
          Logged as office training. It belongs on the annual training plan, but it won&rsquo;t add to anyone&rsquo;s CPD
          hours.
        </p>
      )}
      <textarea
        name="notes"
        placeholder="Notes (optional)"
        rows={2}
        className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        Save session
      </button>
      {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}
