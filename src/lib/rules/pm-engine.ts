import { fillPercent, type StageProgress } from "@/lib/rules/stage-progress";
import {
  PM_COPY,
  PM_STAGES,
  pmExitItem,
  pmGroupOrder,
  pmItem,
  pmItemStage,
  pmMovesFrom,
  pmOrigin,
  pmStage,
  type PmEndedBy,
  type PmGroundKey,
  type PmGroup,
  type PmMove,
  type PmOrigin,
  type PmResolvedItem,
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

export type PmTenancyInput = {
  /** 1 for the first tenancy RealComply sees. Missing reads as 1. */
  seq?: number;
  beforeStages: number[];
  moveInDate: string | null;
  moveOutDate: string | null;
  /** Who ended it, once "Tenant is vacating" has been pressed (brief B1). */
  endedBy?: PmEndedBy | null;
  /** The ground, when the landlord ended it. */
  ground?: PmGroundKey | null;
};

export type PmTicks = Record<string, PmTick | undefined>;

/** An earlier tenancy whose Exit may still be open (brief B2). */
export type PmOutgoingInput = {
  tenancyId: string;
  tenancy: PmTenancyInput;
  /** That tenancy's own ticks. */
  ticks: PmTicks;
};

export type PmEngineInput = {
  origin: PmOrigin;
  group: PmGroup;
  /** The current tenancy. Every property has one from the day it is added. */
  tenancy: PmTenancyInput;
  /**
   * Current state of each tick by item key: the property's onboarding ticks
   * and the current tenancy's ticks together. Keys never collide (nsw-pm.ts
   * keys are unique across stages; a test checks it).
   */
  ticks: PmTicks;
  /** Earlier tenancies, oldest first. Only those whose Exit is not filed show. */
  previous?: PmOutgoingInput[];
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

function stagePresent(stage: PmStage, origin: PmOrigin, seq: number): boolean {
  // Onboarding is done once. Once a property has had a tenancy it is never
  // shown again; the record stays in History (brief B2).
  if (stage.stage === 1) return pmOrigin(origin).hasOnboarding && seq === 1;
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

/**
 * The stage's items as they read for this tenancy: Exit items worded for who
 * ended it and the ground (brief B1), everything else as written.
 */
export function pmStageItems(stage: PmStage, tenancy: PmTenancyInput): PmResolvedItem[] {
  return stage.items.map((item) => pmExitItem(item, tenancy.endedBy ?? null, tenancy.ground ?? null));
}

function tally(items: PmResolvedItem[], ticks: PmTicks) {
  let done = 0;
  let na = 0;
  for (const item of items) {
    // Marked N/A by RealComply (the tenant ended it, or no exclusion period).
    if (item.auto) {
      na++;
      continue;
    }
    const t = ticks[item.key]?.state;
    if (t === "done") done++;
    else if (t === "na" && item.naAllowed) na++;
  }
  return { done, na, total: items.length - na };
}

/** Every stage this property shows, in order, with its count and lock. */
export function pmStageViews(input: PmEngineInput): PmStageView[] {
  const views: PmStageView[] = [];
  let earlierIncomplete = false;
  const seq = input.tenancy.seq ?? 1;
  for (const stage of PM_STAGES) {
    if (!stagePresent(stage, input.origin, seq)) continue;
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

    const { done, na, total } = tally(pmStageItems(stage, input.tenancy), input.ticks);
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

// ── Earlier tenancies (brief B2) ───────────────────────────────────────────

export type PmExitTally = {
  /** Every Exit item ticked, N/A, or the Exit happened before RealComply. */
  complete: boolean;
  before: boolean;
  done: number;
  total: number;
  na: number;
};

export function pmExitTally(tenancy: PmTenancyInput, ticks: PmTicks): PmExitTally {
  if (stageIsBefore(5, tenancy.beforeStages)) return { complete: true, before: true, done: 0, total: 0, na: 0 };
  const { done, na, total } = tally(pmStageItems(pmStage(5), tenancy), ticks);
  return { complete: done >= total, before: false, done, total, na };
}

/**
 * A tenancy is filed under History once its tenant has moved out and its Exit
 * is complete. Until then an earlier tenancy shows at the top of the property
 * as "Outgoing tenant: Exit".
 */
export function pmTenancyFiled(tenancy: PmTenancyInput, ticks: PmTicks): boolean {
  const exit = pmExitTally(tenancy, ticks);
  if (exit.before) return true;
  return exit.complete && Boolean(tenancy.moveOutDate);
}

export type PmOutgoingView = {
  tenancyId: string;
  seq: number;
  tenancy: PmTenancyInput;
  ticks: PmTicks;
  movedOut: boolean;
  exit: PmExitTally;
  items: PmResolvedItem[];
};

/** Earlier tenancies still finishing, oldest first. Never locked. */
export function pmOutgoing(input: PmEngineInput): PmOutgoingView[] {
  return (input.previous ?? [])
    .filter((p) => !pmTenancyFiled(p.tenancy, p.ticks))
    .map((p) => ({
      tenancyId: p.tenancyId,
      seq: p.tenancy.seq ?? 1,
      tenancy: p.tenancy,
      ticks: p.ticks,
      movedOut: Boolean(p.tenancy.moveOutDate),
      exit: pmExitTally(p.tenancy, p.ticks),
      items: pmStageItems(pmStage(5), p.tenancy),
    }));
}

// ── What may be ticked, answered and recorded ──────────────────────────────

/**
 * Whether this tick, N/A or untick is allowed. Null when it is; otherwise the
 * reason, in words for the agent. The server action refuses on anything but
 * null. `outgoingTenancyId` targets an earlier tenancy's Exit, which is never
 * locked (brief B2).
 */
export function pmCanSetItem(
  input: PmEngineInput,
  itemKey: string,
  next: PmTickState,
  outgoingTenancyId?: string | null,
): string | null {
  const item = pmItem(itemKey);
  const stage = pmItemStage(itemKey);
  if (!item || !stage) return "That item is not on this checklist.";
  if (item.kind === "water") return "Answer the water usage questions instead.";

  if (outgoingTenancyId) {
    const out = pmOutgoing(input).find((o) => o.tenancyId === outgoingTenancyId);
    if (!out) return "That tenancy has been filed under History.";
    if (stage.stage !== 5) return "Only the Exit items of an outgoing tenancy can be ticked.";
    const resolved = out.items.find((i) => i.key === itemKey)!;
    if (resolved.auto) return `RealComply has marked that N/A: ${resolved.auto.note.toLowerCase()}.`;
    if (next === "na" && !resolved.naAllowed) return "N/A is not offered on that item.";
    return null;
  }

  const view = pmStageViews(input).find((v) => v.stage === stage.stage);
  if (!view) return "That stage does not apply to this property.";
  if (view.before) return "That happened before the property came to RealComply, so it cannot be ticked here.";
  if (view.locked) return "That stage is locked until the stages before it are complete.";
  const resolved = pmStageItems(stage, input.tenancy).find((i) => i.key === itemKey)!;
  if (resolved.auto) return `RealComply has marked that N/A: ${resolved.auto.note.toLowerCase()}.`;
  if (next === "na" && !resolved.naAllowed) return "N/A is not offered on that item.";
  return null;
}

/** Whether the water usage questions can be answered for the current tenancy. */
export function pmCanAnswerWater(input: PmEngineInput): string | null {
  const view = pmStageViews(input).find((v) => v.stage === 3);
  if (!view) return "That stage does not apply to this property.";
  if (view.before) return "That happened before the property came to RealComply.";
  if (view.locked) return "That stage is locked until the stages before it are complete.";
  return null;
}

/**
 * Whether a record can be added to the current tenancy. A pet on the
 * application belongs to Getting a tenant in, and follows its lock. The
 * Stage 4 records run while the tenant is in: from move-in to move-out.
 */
export function pmCanRecord(input: PmEngineInput, kind: "pet_application" | "ongoing"): string | null {
  if (input.group === "archived") return "This management has ended.";
  if (kind === "pet_application") {
    const view = pmStageViews(input).find((v) => v.stage === 2);
    if (!view || view.before) return "That happened before the property came to RealComply.";
    if (view.locked) return "Getting a tenant in is locked until the stages before it are complete.";
    return null;
  }
  const view = pmStageViews(input).find((v) => v.stage === 4);
  if (!view || view.oval.kind !== "underWay") return "These are recorded while the tenant is in the property.";
  return null;
}

// ── Moves ──────────────────────────────────────────────────────────────────

export type PmMoveCheck = {
  move: PmMove;
  /** Titles of the stages still to finish. */
  blockedBy: string[];
  /** The one short line under a disabled button. Empty when the move can go ahead. */
  line: string;
};

/** "Complete Getting a tenant in and Money and move-in first." */
export function pmBlockedLine(blockedBy: string[]): string {
  if (blockedBy.length === 0) return "";
  const list =
    blockedBy.length === 1 ? blockedBy[0] : `${blockedBy.slice(0, -1).join(", ")} and ${blockedBy[blockedBy.length - 1]}`;
  return `Complete ${list} first.`;
}

/** Every move button for this property's group, the main one first, and what holds each back. */
export function pmMoveChecks(input: PmEngineInput): PmMoveCheck[] {
  const views = pmStageViews(input);
  const outgoingNotOut = pmOutgoing(input).some((o) => !o.movedOut);
  return pmMovesFrom(input.group).map((move) => {
    const blockedBy = move.needs
      .map((n) => views.find((v) => v.stage === n))
      .filter((v): v is PmStageView => Boolean(v) && !v!.complete)
      .map((v) => v.title);
    let line = pmBlockedLine(blockedBy);
    // The new tenant cannot move in until the outgoing tenant has moved out (B2).
    if (!line && move.to === "tenanted" && outgoingNotOut) line = PM_COPY.outgoingNotOut;
    return { move, blockedBy, line };
  });
}

/** The check for one move by its key, or null when it is not offered from this group. */
export function pmMoveCheck(input: PmEngineInput, moveKey: string): PmMoveCheck | null {
  return pmMoveChecks(input).find((c) => c.move.key === moveKey) ?? null;
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
