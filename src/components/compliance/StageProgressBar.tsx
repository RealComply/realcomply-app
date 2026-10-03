import Link from "next/link";
import { Check } from "lucide-react";
import { stageStarted, type StageProgress } from "@/lib/rules/stage-progress";
import type { PropertyStage } from "@/lib/types";

// THE PROGRESS BAR (Adam, 3 Oct 2026). Brief: RealComply-progress-bar-brief-3-Oct.md,
// design approved on the "Option B" mockup the same day. Counting rules live in
// lib/rules/stage-progress.ts; this file only draws them.
//
// It also replaces the row of stage tabs that sat here before. Two rows of the
// same six stage names, one above the other, is clutter, so each oval is the
// link to its stage, the stage being viewed has its name underlined, and a
// stage the file cannot open yet is drawn but not clickable.
//
// ⚠️ REVERSAL 1, 3 Oct 2026: NO "NEXT" LINE. The 23 September design
// (RealComply-progress-and-motivation-design.md) put one line under the bar
// naming the next action. Adam removed it: work inside a stage does not always
// happen in a fixed order, so naming "the next thing" can be wrong for a given
// property. The count is enough. Do not add a next-action line back.
//
// ⚠️ REVERSAL 2, 3 Oct 2026: THE STAGE HOLD MESSAGE IS GONE. The amber note
// "This file is at Pre-market, but it is held at Listing set-up until these
// cards are complete: ... Nothing in the later stages is lost." was removed
// from the listing page. Adam: the user does not need to see the system's
// reasoning; this bar replaces it. Do not replace it with a to-do list or any
// other message. The gating rules themselves are unchanged (lib/rules/stage-hold.ts).
//
// Wording rules for anything drawn on the bar: no noun for what is counted
// (not cards, tasks, items or steps), no "to go", "remaining" or percentages,
// and never the word "compliant".

export type StageProgressBarStage = StageProgress & {
  stage: PropertyStage;
  label: string;
  /** The file can open this stage now. Locked stages are drawn but not links. */
  reachable: boolean;
};

const OVAL: Record<StageProgress["state"], string> = {
  inProgress: "border-rc-green-deep bg-rc-green-soft text-rc-ink",
  finished: "border-rc-green-deep bg-rc-green-deep text-white",
  notStarted: "border-rc-border bg-white text-rc-faint",
  flagged: "border-rc-red bg-rc-red-soft text-rc-red",
};

function ovalText(s: StageProgress): string {
  return s.state === "flagged" ? `! ${s.done} of ${s.total}` : `${s.done} of ${s.total}`;
}

// For screen readers only. The visible oval carries one thing, so the state
// has to be said in words somewhere.
function spokenState(s: StageProgress): string {
  switch (s.state) {
    case "finished":
      return "finished";
    case "flagged":
      return `${s.done} of ${s.total}, flagged`;
    case "inProgress":
      return `${s.done} of ${s.total}, in progress`;
    default:
      return `${s.done} of ${s.total}, not started`;
  }
}

export function StageProgressBar({
  propertyId,
  stages,
  viewedStage,
}: {
  propertyId: string;
  stages: StageProgressBarStage[];
  viewedStage: PropertyStage;
}) {
  return (
    // Phones: the six ovals keep a readable width and the row scrolls sideways
    // inside this container. The page itself never scrolls sideways.
    <nav aria-label="Stages" className="-mx-1 overflow-x-auto px-1 pb-1 pt-0.5">
      <ol className="grid min-w-[504px] grid-cols-6">
        {stages.map((s, i) => {
          const viewed = s.stage === viewedStage;
          const oval = (
            <span
              className={`mx-auto flex h-[29px] w-[calc(100%-16px)] items-center justify-center rounded-full border-2 text-xs font-bold tabular-nums transition ${OVAL[s.state]}`}
              aria-hidden="true"
            >
              {s.state === "finished" ? <Check size={15} strokeWidth={3} /> : ovalText(s)}
            </span>
          );
          const name = (
            <span
              className={`mt-1.5 block truncate px-1 text-[11.5px] ${
                viewed
                  ? "font-semibold text-rc-ink underline decoration-rc-green-deep decoration-2 underline-offset-4"
                  : s.state === "notStarted"
                    ? "font-medium text-rc-faint"
                    : "font-medium text-rc-muted"
              }`}
              aria-hidden="true"
            >
              {s.label}
            </span>
          );
          const spoken = `${s.label}: ${spokenState(s)}${s.reachable ? "" : ", locked"}`;
          return (
            <li key={s.stage} className="relative text-center">
              {/* The joining line sits only in the gap between two ovals:
                  each oval is inset 8px from its column edge, so the line runs
                  from 8px left of the edge to 8px right of it. Green when the
                  stage on its right has started. */}
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute -left-2 top-[13px] h-[3px] w-4 rounded-full ${
                    stageStarted(s) ? "bg-rc-green-deep" : "bg-rc-border"
                  }`}
                />
              )}
              {s.reachable ? (
                <Link
                  href={`/dashboard/${propertyId}?stage=${s.stage}`}
                  aria-label={spoken}
                  aria-current={viewed ? "page" : undefined}
                  className="group block rounded-lg outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-rc-green-deep/50"
                >
                  {oval}
                  {name}
                </Link>
              ) : (
                <span className="block cursor-default" aria-label={spoken} role="img">
                  {oval}
                  {name}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
