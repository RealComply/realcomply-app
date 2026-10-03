import type { PropertyItemStatus } from "@/lib/types";

// THE PROGRESS BAR (Adam, 3 Oct 2026; brief RealComply-progress-bar-brief-3-Oct.md).
//
// One oval per stage at the top of the listing page. Each shows exactly one
// thing: "7 of 9" while in progress, a tick when finished, "0 of 4" greyed when
// not started, and "! 2 of 5" in red when anything in the stage is flagged.
// Each oval is also its own small progress bar: its colour fills from the left
// in proportion to the count (fillPercent below).
//
// How the count works:
//   - The second number is every item that applies to this listing in that
//     stage: whatever itemsForStage returns, required or not. Items that do not
//     apply (pool, tenancy, strata on a listing without them) never reach it.
//   - The first number is items that are genuinely complete, which in this app
//     is status "done" read through withEffectiveEspStatus. A card that was
//     opened but is missing a required record is not "done", and the ESP
//     reasoning card counts by its rule (lib/rules/esp-reasoning-gate.ts),
//     not by its stored status.
//   - A flag wins over everything. A stage with an open flag never shows a
//     tick and never looks finished, however many of its items are recorded.

export type StageProgressState = "notStarted" | "inProgress" | "finished" | "flagged";

export type StageProgress = {
  done: number;
  total: number;
  state: StageProgressState;
};

/**
 * Progress for one stage, from the statuses of the items that apply to it
 * (undefined for an item nobody has touched yet).
 */
export function stageProgress(statuses: (PropertyItemStatus | undefined)[]): StageProgress {
  const total = statuses.length;
  const done = statuses.filter((s) => s === "done").length;
  const flagged = statuses.some((s) => s === "flagged");
  const state: StageProgressState = flagged
    ? "flagged"
    : done === total
      ? "finished"
      : done > 0
        ? "inProgress"
        : "notStarted";
  return { done, total, state };
}

/** Whether a stage has started: anything recorded in it, or anything flagged. */
export function stageStarted(progress: StageProgress): boolean {
  return progress.state !== "notStarted";
}

/**
 * How much of the oval is coloured in, as a whole percentage: the share of the
 * stage that is done. "7 of 9" fills 78%. A finished stage is full; so is any
 * stage with nothing to do, which reads as finished. Anything short of
 * finished stays under 100. A flagged stage fills by
 * its count like any other, in red, and never reaches 100% because the
 * flagged item is not done.
 */
export function fillPercent(progress: StageProgress): number {
  if (progress.done >= progress.total) return 100;
  // Rounded, but a stage that is not finished never rounds up to looking full.
  return Math.min(99, Math.round((100 * progress.done) / progress.total));
}
