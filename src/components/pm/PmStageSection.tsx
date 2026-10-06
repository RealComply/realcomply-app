"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// One stage on a PM property page: a title bar with the stage name and its
// count, and the stage's rows under it (brief A5).
//
// ⚠️ REVERSAL (Adam, 6 Oct 2026, after the mockup was approved): THE TITLE BAR
// IS NOT DARK. It is a soft green tint (--rc-green-soft) with dark text, a thin
// solid green strip down its left edge, and a hairline under it when the
// section is open. This is what sets PM apart from sales. Do not use black or
// near-black for these bars. The main navigation is unchanged.
//
// A finished stage folds shut and an arrow reopens it. A locked stage, and a
// stage that happened before RealComply, is faded and cannot be opened.

export function PmStageSection({
  stage,
  number,
  title,
  cadence,
  countLabel,
  finished,
  locked,
  before,
  startOpen,
  children,
}: {
  stage: number;
  number: number;
  title: string;
  cadence: string;
  countLabel: string;
  finished: boolean;
  locked: boolean;
  before: boolean;
  startOpen: boolean;
  children: ReactNode;
}) {
  const shut = locked || before;
  const [open, setOpen] = useState(startOpen && !shut);
  // Fold the moment a stage finishes, unfold the moment it reopens. Adjusted
  // during render, as the sales cards do, so a finished stage never paints one
  // frame open.
  // The same when a stage unlocks: it opens ready to work, unless finished.
  const [was, setWas] = useState({ finished, shut });
  if (was.finished !== finished || was.shut !== shut) {
    setWas({ finished, shut });
    setOpen(!finished && !shut);
  }
  const isOpen = open && !shut;

  return (
    <section id={`stage-${stage}`} className="mt-4 scroll-mt-48 overflow-hidden rounded-card border border-rc-border bg-white shadow-card">
      <h2>
        <button
          type="button"
          disabled={shut}
          aria-expanded={shut ? undefined : isOpen}
          onClick={() => setOpen((o) => !o)}
          className={`flex w-full items-center gap-2.5 border-l-[3px] border-rc-green-deep bg-rc-green-soft py-3 pl-3.5 pr-4 text-left text-sm font-bold text-rc-ink transition ${
            isOpen ? "border-b border-b-rc-border" : ""
          } ${shut ? "cursor-not-allowed opacity-50" : "hover:brightness-[0.98]"}`}
        >
          <span>
            {number}. {title}
          </span>
          <span className="hidden text-xs font-medium text-rc-muted sm:inline">{cadence}</span>
          <span className="ml-auto whitespace-nowrap text-[13px] font-semibold tabular-nums text-rc-ink/80">
            {before ? "Before RealComply" : locked ? "Locked" : countLabel}
          </span>
          {!shut && (
            <ChevronRight
              size={17}
              aria-hidden="true"
              className={`shrink-0 text-rc-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          )}
        </button>
      </h2>
      {/* Hidden, not removed, so a row's pending save is never thrown away by a fold. */}
      <div hidden={!isOpen}>{children}</div>
    </section>
  );
}
