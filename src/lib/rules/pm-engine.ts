import { fillPercent, type StageProgress } from "@/lib/rules/stage-progress";
import {
  PM_STAGES,
  pmGroupOrder,
  pmItem,
  pmItemStage,
  pmMoveFrom,
  pmOrigin,
  pmStage,
  type PmGroup,
  type PmMove,
  type PmOrigin,
  type PmStage,
  type PmStageNumber,
} from "@/lib/rules/nsw-pm";

// THE PM ENGINE. Reads the content in nsw-pm.ts and works out, for one
// property: which stages show, which are "Before RealComply", what each counts,
// which are locked, and whether the move button works. It knows nothing about
// NSW, so another state is a new content file, not a new engine.
//
// The server actions (lib/actions/pm.ts) call the same functions before every
// tick and every move, so the locking is enforced on the server and not only
// on the screen (brief A7).
//
// ⚠️ REVERSAL 1, 6 Oct 2026: PM HOLDS AT A STAGE LIKE SALES DOES. Earlier the
// same day a property could move on with items still open. Adam reversed it:
// a later stage is locked until every earlier stage is complete. A finished
// stage can be reopened and unticked; later stages then lock again, and
// nothing ticked in them is lost (the rows are not touched, only locked).

export type PmTickState = "done" | "na" | "open";

export type PmTick = {
  state: PmTickState;
  changedBy: string;
  changedAt: string;
};

export type PmEngineInput = {
  origin: PmOrigin;
  group: PmGroup;
  /** The current tenancy. Every property has one from the day it is added. */
  tenancy: {
    beforeStages: number[];
    moveInDate: string | null;
    moveOutDate: string | null;
  };
  /**
   * Current state of each tick by item key: the property's onboarding ticks
   * and the current tenancy's ticks together. Keys never collide (nsw-pm.ts
   * keys are unique across stages; a test checks it).
   */
  ticks: Record<string, PmTick | undefined>;
};

export type PmOval =
  | { kind: "earlier" }
  | { kind: "count"; progress: StageProgress; fill: number }
  | { kind: "tick" }
  | { kind: "notStarted" } // Stage 4 before move-in
  | { kind: "underWay" }; // Stage 4 during the tenancy

export type PmStageView = {
  stage: PmStageNumber;
  title: string;
  cadence: string;
  /** Numbered in the order shown, so an existing property starts at 1. */
  displayNumber: number;
  ongoing: boolean;
  /** Happened before the property came to RealComply. Greyed, never tickable. */
  before: boolean;
  /** The property's group has reached the point where this stage is worked. */
  reached: boolean;
  /** Cannot be opened or ticked: not reached yet, or an earlier stage is incomplete. */
  locked: boolean;
  /** Ticked items. */
  done: number;
  /** Items still counted (everything minus N/A). */
  total: number;
  /** Items marked N/A. */
  na: number;
  /** Every counted item ticked. For Stage 4: the tenancy has closed. */
  finished: boolean;
  /** Counts as complete for locking: finished, or before RealComply. */
  complete: boolean;
  oval: PmOval;
};

function stagePresent(stage: PmStage, origin: PmOrigin): boolean {
  if (stage.stage === 1) return pmOrigin(origin).hasOnboarding;
  return true;
}

function stageIsBefore(stage: PmStageNumber, beforeStages: number[]): boolean {
  if (beforeStages.includes(stage)) return true;
  // An existing vacant property's last tenancy, Exit included, all happened
  // before RealComply, so the ongoing tenancy between them did too. Shown as
  // "Earlier" rather than with a tick, because a tick would read as RealComply
  // having seen that tenancy close.
  if (stage === 4) return beforeStages.includes(5);
  return false;
}

function stageReached(stage: PmStage, group: PmGroup): boolean {
  return pmGroupOrder(group) >= pmGroupOrder(stage.opensIn);
}

function tally(stage: PmStage, ticks: PmEngineInput["ticks"]) {
  let done = 0;
  let na = 0;
  for (const item of stage.items) {
    const t = ticks[item.key]?.state;
    if (t === "done") done++;
    else if (t === "na" && item.naAllowed) na++;
  }
  return { done, na, total: stage.items.length - na };
}

/** Every stage this property shows, in order, with its count and lock. */
export function pmStageViews(input: PmEngineInput): PmStageView[] {
  const views: PmStageView[] = [];
  let earlierIncomplete = false;
  for (const stage of PM_STAGES) {
    if (!stagePresent(stage, input.origin)) continue;
    const before = stageIsBefore(stage.stage, input.tenancy.beforeStages);
    const reached = before || stageReached(stage, input.group);

    if (stage.ongoing) {
      // Stage 4 has no count and never blocks another stage.
      const closed = Boolean(input.tenancy.moveOutDate);
      const underWay = !closed && (input.group === "tenanted" || input.group === "tenant_vacating");
      views.push({
        stage: stage.stage,
        title: stage.title,
        cadence: stage.cadence,
        displayNumber: views.length + 1,
        ongoing: true,
        before,
        reached,
        locked: false,
        done: 0,
        total: 0,
        na: 0,
        finished: closed,
        complete: true,
        oval: before ? { kind: "earlier" } : closed ? { kind: "tick" } : underWay ? { kind: "underWay" } : { kind: "notStarted" },
      });
      continue;
    }

    const { done, na, total } = tally(stage, input.ticks);
    const finished = !before && done >= total;
    const complete = before || finished;
    const locked = !before && (!reached || earlierIncomplete);
    const progress: StageProgress = {
      done,
      total,
      state: finished ? "finished" : done > 0 ? "inProgress" : "notStarted",
    };
    views.push({
      stage: stage.stage,
      title: stage.title,
      cadence: stage.cadence,
      displayNumber: views.length + 1,
      ongoing: false,
      before,
      reached,
      locked,
      done: before ? 0 : done,
      total: before ? 0 : total,
      na: before ? 0 : na,
      finished,
      complete,
      oval: before ? { kind: "earlier" } : finished ? { kind: "tick" } : { kind: "count", progress, fill: fillPercent(progress) },
    });
    if (!complete) earlierIncomplete = true;
  }
  return views;
}

/** "7 of 9 (1 N/A)": the count on a stage's title bar. */
export function pmStageCountLabel(view: PmStageView): string {
  return `${view.done} of ${view.total}${view.na > 0 ? ` (${view.na} N/A)` : ""}`;
}

/**
 * Whether this tick, N/A or untick is allowed. Null when it is; otherwise the
 * reason, in words for the agent. The server action refuses on anything but null.
 */
export function pmCanSetItem(input: PmEngineInput, itemKey: string, next: PmTickState): string | null {
  const item = pmItem(itemKey);
  const stage = pmItemStage(itemKey);
  if (!item || !stage) return "That item is not on this checklist.";
  const view = pmStageViews(input).find((v) => v.stage === stage.stage);
  if (!view) return "That stage does not apply to this property.";
  if (view.before) return "That happened before the property came to RealComply, so it cannot be ticked here.";
  if (view.locked) return "That stage is locked until the stages before it are complete.";
  if (next === "na" && !item.naAllowed) return "N/A is not offered on that item.";
  return null;
}

export type PmMoveCheck = {
  move: PmMove;
  /** Titles of the stages still to finish. Empty when the move can go ahead. */
  blockedBy: string[];
};

/** The move button for this property's group, and what is holding it back. */
export function pmMoveCheck(input: PmEngineInput): PmMoveCheck | null {
  const move = pmMoveFrom(input.group);
  if (!move) return null;
  const views = pmStageViews(input);
  const blockedBy = move.needs
    .map((n) => views.find((v) => v.stage === n))
    .filter((v): v is PmStageView => Boolean(v) && !v!.complete)
    .map((v) => v.title);
  return { move, blockedBy };
}

/** "Complete Getting a tenant in and Money and move-in first." */
export function pmBlockedLine(blockedBy: string[]): string {
  if (blockedBy.length === 0) return "";
  const list =
    blockedBy.length === 1 ? blockedBy[0] : `${blockedBy.slice(0, -1).join(", ")} and ${blockedBy[blockedBy.length - 1]}`;
  return `Complete ${list} first.`;
}

export type PmCardSummary =
  | { kind: "count"; stageTitle: string; progress: StageProgress; fill: number }
  | { kind: "underWay" }
  | { kind: "tick"; label: string }
  | { kind: "archived" };

/**
 * The one small oval on a dashboard card: the stage the property is working
 * on, by its count. Tenanted shows "Under way", Vacant a tick and "Vacant"
 * (brief A3), unless an earlier stage still has something open, which shows
 * instead so a dashboard never hides work.
 */
export function pmCardSummary(input: PmEngineInput): PmCardSummary {
  if (input.group === "archived") return { kind: "archived" };
  const views = pmStageViews(input);
  const working = views.find((v) => !v.ongoing && !v.before && v.reached && !v.finished);
  if (working && working.oval.kind === "count") {
    return { kind: "count", stageTitle: working.title, progress: working.oval.progress, fill: working.oval.fill };
  }
  if (input.group === "tenanted") return { kind: "underWay" };
  if (input.group === "vacant") return { kind: "tick", label: "Vacant" };
  const lastDone = [...views].reverse().find((v) => !v.ongoing && v.reached && v.finished);
  return { kind: "tick", label: lastDone?.title ?? pmStage(1).title };
}
