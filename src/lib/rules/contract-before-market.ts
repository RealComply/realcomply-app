// THE CONTRACT BEFORE THE MARKET (Adam, 5 Nov 2026; raised by a user).
//
// REVERSAL. Was: Add a listing needed the contract uploaded before the file
// could start. Now: it needs only the agency agreement and the comparable
// sales report, and the contract goes on its card in Pre-market (b1,
// "Contract of sale prepared with prescribed documents"). Why: agents often
// list and organise marketing while still waiting on the contract, and
// couldn't start the compliance file.
//
// So the guard moves with it: the listing can't go into On market until the
// contract card is done. A card can't be newly marked done without the
// contract attached (setItemStatus). Cards already done stay as they are
// (live listings: nothing already done changes).
//
// THE LAW. Property and Stock Agents Act 2002 (NSW), the section that stops a
// property being offered for sale until the contract is available for
// inspection (s63, as the "Date the contract was received" card, b1a, cites
// it). QUOTE PENDING, NOT FROM MEMORY: this session's network couldn't reach
// legislation.nsw.gov.au on 5 Nov 2026, so the section's words go here,
// copied from the Act itself, before this merges.

/** The contract card. */
export const CONTRACT_KEY = "b1";

/** Pre-market, as stored on properties.stage: completing it puts the listing On market. */
export const PRE_MARKET_STAGE = 1;

/**
 * What the agent sees: the title and the link, nothing more (Master, 5 Nov
 * 2026, final). The section's own words stay in this file's comment above.
 */
export const CONTRACT_NEEDED = "Contract needed before the property goes on the market.";
export const S63_LABEL_ACT = "Property and Stock Agents Act 2002 (NSW),";
export const S63_LABEL_SECTION = "section 63";
export const S63_URL = "https://legislation.nsw.gov.au/view/html/inforce/current/act-2002-066#sec.63";

/** Marking the contract card done with no contract on it. */
export const CONTRACT_NOT_ATTACHED = "Upload the contract before marking this done.";

/**
 * Why "Continue to On market" is refused, or null when it isn't. `incomplete`
 * is the stage's required cards that aren't complete. When the contract card
 * is one of them on Pre-market, the message is CONTRACT_NEEDED first, and the
 * page shows the Act's link under it (ContractNeededNote).
 */
export function completeStageRefusal(input: {
  stage: number;
  incomplete: { key: string; label: string }[];
}): string | null {
  const contractMissing =
    input.stage === PRE_MARKET_STAGE && input.incomplete.some((i) => i.key === CONTRACT_KEY);
  const others = input.incomplete.filter((i) => !(contractMissing && i.key === CONTRACT_KEY)).map((i) => i.label);
  if (contractMissing) {
    return others.length > 0 ? `${CONTRACT_NEEDED} ${alsoComplete(others)}` : CONTRACT_NEEDED;
  }
  return others.length > 0 ? `Complete these first: ${others.join(", ")}.` : null;
}

const alsoComplete = (labels: string[]) => `Also complete: ${labels.join(", ")}.`;

/** A refusal for the contract, split for the page: the rest after the title, or null. */
export function contractRefusalParts(error: string | null | undefined): { also: string | null } | null {
  if (!error || !error.startsWith(CONTRACT_NEEDED)) return null;
  const rest = error.slice(CONTRACT_NEEDED.length).trim();
  return { also: rest || null };
}
