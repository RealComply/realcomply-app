// WHAT EACH SALE IS STILL MISSING (Master, from Adam's decisions, 11 Nov 2026).
//
// A comparable sale needs its address, sold price, sale date, bedrooms,
// bathrooms, car spaces and land size (Adam: "it needs the address of
// properties, bed, bath, cars, land size, price"). Under each sale on the ESP
// reasoning card, the ones still empty are named, so an agent entering the
// sales from their report by hand ("This is my report"), or checking what the
// reader took, fills only the gaps with Edit details.
//
// A 0 is filled in, not missing: a studio's 0 bedrooms is an answer (11 Nov
// 2026). Land size isn't asked for on a strata listing, where a sale's land
// is usually the whole site's, nor where a whole-site figure was hidden
// (lib/rules/strata-land.ts).

type SaleFigures = {
  salePrice: number | null;
  saleDate: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landSizeSqm: number | null;
  landSizeHidden?: boolean;
};

/** The details a sale is still missing, in the order Edit details shows them. */
export function missingSaleDetails(sale: SaleFigures, strataListing: boolean): string[] {
  const missing: string[] = [];
  if (sale.bedrooms === null) missing.push("bedrooms");
  if (sale.bathrooms === null) missing.push("bathrooms");
  if (sale.carSpaces === null) missing.push("car spaces");
  if (sale.landSizeSqm === null && !sale.landSizeHidden && !strataListing) missing.push("land size");
  if (sale.salePrice === null) missing.push("sold price");
  if (sale.saleDate === null) missing.push("sale date");
  return missing;
}

/** "Still to add: bedrooms, car spaces and sale date." Null when nothing is missing. */
export function missingSaleLine(missing: string[]): string | null {
  if (missing.length === 0) return null;
  const words = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Still to add: ${words}.`;
}
