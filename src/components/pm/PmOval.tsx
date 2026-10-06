import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import type { PmCardSummary, PmOval as PmOvalData } from "@/lib/rules/pm-engine";

// One PM oval. Same look and rules as the sales progress bar
// (components/compliance/StageProgressBar.tsx, brief
// RealComply-progress-bar-brief-3-Oct.md): an elongated oval that fills from
// the left by its count, a tick when finished, grey when not started. No noun
// for what is counted, just "7 of 9", and never the word "compliant".
//
// PM adds three words of its own (brief A5): "Earlier" for a stage that
// happened before RealComply, and "Not started" / "Under way" for Stage 4,
// which has no count.

const BASE =
  "flex items-center justify-center rounded-full border-2 font-bold tabular-nums whitespace-nowrap transition";

function fillStyle(fill: number): CSSProperties {
  return { backgroundImage: `linear-gradient(to right, var(--rc-green-fill) ${fill}%, transparent ${fill}%)` };
}

export function pmOvalSpoken(oval: PmOvalData): string {
  switch (oval.kind) {
    case "earlier":
      return "before RealComply";
    case "tick":
      return "finished";
    case "notStarted":
      return "not started";
    case "underWay":
      return "under way";
    case "count":
      return `${oval.progress.done} of ${oval.progress.total}${oval.progress.done === 0 ? ", not started" : ", in progress"}`;
  }
}

export function PmOval({ oval, className = "" }: { oval: PmOvalData; className?: string }) {
  switch (oval.kind) {
    case "tick":
      return (
        <span className={`${BASE} border-rc-green-deep bg-rc-green-deep text-white ${className}`} aria-hidden="true">
          <Check size={15} strokeWidth={3} />
        </span>
      );
    case "earlier":
      return (
        <span className={`${BASE} border-rc-border bg-rc-bg-alt text-rc-muted ${className}`} aria-hidden="true">
          Earlier
        </span>
      );
    case "notStarted":
      return (
        <span className={`${BASE} border-rc-border bg-white text-rc-muted ${className}`} aria-hidden="true">
          Not started
        </span>
      );
    case "underWay":
      return (
        <span className={`${BASE} border-rc-green-deep bg-rc-green-soft text-rc-green-deep ${className}`} aria-hidden="true">
          Under way
        </span>
      );
    case "count": {
      const started = oval.progress.done > 0;
      return (
        <span
          className={`${BASE} ${started ? "border-rc-green-deep text-rc-ink" : "border-rc-border text-rc-muted"} bg-white ${className}`}
          style={started ? fillStyle(oval.fill) : undefined}
          aria-hidden="true"
        >
          {oval.progress.done} of {oval.progress.total}
        </span>
      );
    }
  }
}

/** The small oval on a dashboard card. */
export function PmCardOval({ summary }: { summary: PmCardSummary }) {
  const size = "h-6 w-full text-xs";
  switch (summary.kind) {
    case "count":
      return <PmOval oval={{ kind: "count", progress: summary.progress, fill: summary.fill }} className={size} />;
    case "underWay":
      return <PmOval oval={{ kind: "underWay" }} className={size} />;
    case "tick":
      return (
        <span className={`${BASE} ${size} gap-1 border-rc-green-deep bg-rc-green-deep text-white`} aria-hidden="true">
          <Check size={13} strokeWidth={3} /> {summary.label}
        </span>
      );
    case "archived":
      return (
        <span className={`${BASE} ${size} border-rc-border bg-rc-bg-alt text-rc-muted`} aria-hidden="true">
          Archived
        </span>
      );
  }
}

export function pmCardSpoken(summary: PmCardSummary): string {
  switch (summary.kind) {
    case "count":
      return `${summary.stageTitle}: ${summary.progress.done} of ${summary.progress.total}`;
    case "underWay":
      return "Tenancy under way";
    case "tick":
      return `${summary.label}, finished`;
    case "archived":
      return "Archived";
  }
}
