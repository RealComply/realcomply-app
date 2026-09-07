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
