// Things that bear on the price but do not belong to any one comparable sale.
//
// Adam, 7 Sep 2026: "anything that relates specifically to a property we could
// have two columns, one for similarities and another for the differences, and
// then a second for generic such as zoning."
//
// He is drawing a real distinction. "120m² less land" is a fact about one sale
// and belongs on that sale's row. Zoning, an overlay, or where the market is
// this month are facts about the listing, or about the world, and putting them
// on a row would say something false — that they explain the gap between this
// property and that one particular sale.
//
// PROMPTS, NOT FIELDS, and not tick boxes. Same rule as the REINSW factors in
// esp-prompts.ts, for the same reason: none of these is prescribed anywhere in
// the Act or the Regulation, so recording a set of them would invent a
// checklist the law does not ask for and that every file would then carry
// identically. Clicking one inserts a heading into the reasoning box and
// records nothing either way.
//
// Kept deliberately short. The REINSW list is thirty-four; this is ten, and
// each one is something an agent in NSW actually says out loud when explaining
// a price.
//
// THREE OF THEM APPEAR ELSEWHERE IN THE FILE AS OBLIGATIONS, and I proposed
// cutting two of them on 7 Sep 2026 as duplication. Adam pushed back and was
// right:
//
//   "School catchment is definitely a factor when valuing property... Easements
//    could also be a factor because someone might want to put in a pool."
//
// The mistake in my reasoning was treating one fact as one record. A sewer
// easement on the sales inspection report (Sch 2 r 3(2)(j)) is a disclosure of
// an encumbrance known to the agent. The same easement here is why a buyer
// cannot put a pool in the back yard, which is a price argument. Same fact,
// two different questions, and answering both is not double entry.
//
// A warning line about that was added under the panel and then removed the
// same day. Adam: "the agent would have to physically tick the box saying it's
// flood... we're still leaving it up to them when it comes to the generic
// topics for consideration."
//
// He is right twice over. Structurally, "Material facts identified" is
// requiredForStageCompletion, so a file cannot leave Listing set-up without
// the agent actioning that card — the failure I was guarding against cannot
// happen quietly. And in principle, a compliance warning printed under a list
// of thinking prompts makes the prompts look like rules, which is the exact
// thing this file's header says not to do. These are topics to consider. What
// the agent does with them is theirs.

export const ESP_GENERIC_FACTORS: string[] = [
  "Zoning and what it allows",
  "Planning overlays or restrictions",
  "Flood or bushfire",
  "Position on the street",
  "Aspect and outlook",
  "School catchment",
  "Where the market is right now",
  "Time of year",
  "Tenanted at sale",
  "Easements or access",
];
