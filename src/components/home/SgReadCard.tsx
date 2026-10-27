"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { BookOpenCheck } from "lucide-react";
import { confirmSgRead, type SgReadState } from "@/lib/actions/sg-annexure";
import { SG_READ_BUTTON, SG_READ_TEXT, SG_READ_TICK, SG_READ_TITLE } from "@/lib/sg-annexure/office-read";

// Read and tick, on an agent's Home in an office (brief, 14 Oct 2026). Shows
// once the office has adopted the annexure, until the agent confirms; new and
// existing agents alike. Never shown to the licensee, an assistant or an agent
// on their own plan. Confirm stays grey until the box is ticked, and the
// database records it once however often it is pressed. Nothing is locked if
// they never tick.

const initial: SgReadState = { error: null };

export function SgReadCard() {
  const [ticked, setTicked] = useState(false);
  const [state, action, pending] = useActionState(confirmSgRead, initial);

  return (
    // id: "Set up your profile" sends its Read step here (Adam, 27 Oct 2026).
    <section id="sg-read" className="mt-6 scroll-mt-6 rounded-card border-2 border-rc-green-deep bg-white px-4 py-4 shadow-card sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rc-green-soft text-rc-green-deep">
          <BookOpenCheck size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-rc-ink">{SG_READ_TITLE}</h2>
          <p className="mt-1 text-sm leading-relaxed text-rc-muted">{SG_READ_TEXT}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href="/dashboard/annexure" className="font-semibold text-rc-green-deep hover:underline">
              Read the annexure
            </Link>
            <Link href="/dashboard/sg-manual" className="font-semibold text-rc-green-deep hover:underline">
              Read your Supervision Guidelines
            </Link>
          </p>
        </div>
      </div>
      <form action={action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label className="flex items-start gap-2.5 text-sm text-rc-ink">
          <input
            type="checkbox"
            name="read"
            value="yes"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-rc-green-deep"
          />
          <span>{SG_READ_TICK}</span>
        </label>
        <button
          type="submit"
          disabled={!ticked || pending}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
        >
          {pending ? "Saving…" : SG_READ_BUTTON}
        </button>
      </form>
      {state.error && (
        <p role="alert" className="mt-3 text-sm font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </section>
  );
}
