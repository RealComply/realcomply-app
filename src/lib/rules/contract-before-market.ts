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
// THE LAW. Property and Stock Agents Act 2002 (NSW), section 63, word for
// word from the Act as checked in at src/lib/legislation/psa-act-2002.ts
// (the official PDF, "Current version for 29 June 2026 to date", accessed
// 4 August 2026). Only the PDF's page footer between (5)(b) and its last
// words is left out. Agents see just the title and a link to the section
// (Master, 5 Nov 2026); the words stay here.
//
//   63 Proposed contract for sale of residential property
//   (1) In this section—
//   purchaser includes a grantee of an option.
//   (2) A real estate agent must not offer residential property for sale unless the required
//   documents are all available for inspection at the real estate agent’s registered office
//   by a prospective purchaser or agent for a prospective purchaser at all times at which
//   an offer to purchase the property may be made (or at such other place or at such
//   other times as may be prescribed by the regulations).
//   (3) A real estate agent is considered to offer residential property for sale when the agent,
//   expressly or by implication—
//   (a) indicates that residential property is for sale or is to be auctioned at any future
//   time, or
//   (b) offers to sell residential property, or
//   (c) invites an offer to purchase residential property, or
//   (d) indicates that a person may be willing to grant an option to purchase residential
//   property.
//   (4) The required documents for the purposes of this section are—
//   (a) a copy of the proposed contract for the sale of the property (excluding particulars
//   of the purchaser and purchase price), and
//   (b) the documents required by section 52A of the Conveyancing Act 1919 to be
//   attached to the contract before signature by the purchaser, and
//   (c) in the case of an option to purchase residential property—a copy of the proposed
//   option document (excluding particulars of the purchaser and consideration for the
//   option).
//   (5) Without limiting this section, a real estate agent is taken to indicate that residential
//   property is for sale if the real estate agent does any of the following or causes or
//   permits any of the following to be done—
//   (a) advertises or promotes the property in any way that, in the circumstances, may
//   reasonably be taken to indicate that the property is or may be for sale,
//   (b) places a sign on or near the property that, in the circumstances, may reasonably
//   be taken to indicate that the property is or may be for sale,
//   (c) advertises or in any way gives notice that the property is to be auctioned at any
//   future time,
//   (d) places on display particulars or a description of, or a photograph, drawing or other
//   representation of, the property in or on any premises, vehicle or place where the
//   real estate agent conducts business as a real estate agent,
//   (e) shows the property to a prospective purchaser or gives the address of the
//   property to a prospective purchaser.
//   (6) This section does not apply to anything done by a real estate agent when acting on
//   behalf of a prospective purchaser of residential property.
//   (7) The regulations may create exceptions to this section.
//   Maximum penalty—500 penalty units.

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
