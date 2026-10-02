import type { PropertyStage } from "@/lib/types";

// THE STAGE HOLD (Adam, 3 Oct 2026).
//
// "So that an agent can't go back and edit or have something incomplete and
// they still be allowed to move forward. If anything that's done gets marked
// as undone, it should then close off the gate to the next stage but also not
// lose any data that's been put in in future stages."
//
// Raised on 10 Summerhaze Place: the ESP reasoning card in Listing set-up read
// as not complete, yet the later stage tabs stayed open, because a file's
// stage only ever moved forward. Completing a stage checked that stage's cards
// once; nothing re-checked them if one went back to open afterwards (a card
// re-opened, a rule tightened as the ESP card's did on 2 Oct, or the stage
// passed in test mode).
//
// Now, outside test mode, the stage a file is worked at is the first stage at
// or below its stored stage with a required card not complete. Later tabs lock
// and Continue is refused until those cards are done. The stored stage and
// every later card are left exactly as they are, so nothing entered further on
// is lost, and once the earlier cards are complete the file is straight back
// at its own stage.
//
// A file the licensee has signed off is never held: re-opening a signed record
// because something changed afterwards would make the signature read as
// covering something it never saw (same reasoning as esp-reasoning-gate.ts).

export type StageHold = {
  /** The stage the file is worked at now. */
  stage: PropertyStage;
  /** Labels of the required cards holding it there. Empty when not held. */
  waitingOn: string[];
};

export function stageHold(input: {
  storedStage: PropertyStage;
  testMode: boolean;
  signedOff: boolean;
  /** Labels of the required cards in that stage that are not complete. */
  incompleteRequired: (stage: PropertyStage) => string[];
}): StageHold {
  if (input.testMode || input.signedOff) return { stage: input.storedStage, waitingOn: [] };
  for (let s = 0; s < input.storedStage; s++) {
    const waitingOn = input.incompleteRequired(s as PropertyStage);
    if (waitingOn.length > 0) return { stage: s as PropertyStage, waitingOn };
  }
  return { stage: input.storedStage, waitingOn: [] };
}
