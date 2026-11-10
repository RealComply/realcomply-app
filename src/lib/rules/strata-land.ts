// Land size on a unit, townhouse or duplex on strata (Adam, 10 Nov 2026).
//
// A comparable-sales report gives a strata lot the land of the whole strata
// site: a two-bedroom unit "on 2,400 m²". Compared, drafted or put on the
// Statement of Information, that figure says the opposite of the truth. So
// when the listing is a unit, apartment, townhouse, villa, duplex or terrace
// on strata, any land size over 500 m², the listing's own or a sale's, is not
// shown and not used: the card says "Land size not shown (likely the whole
// strata site)" in its place, the comparison and the draft leave land out,
// and the Statement of Information leaves the box empty. The figure stays in
// the database as it was read; nothing is deleted. Floor area is unchanged.
//
// "On strata" is the listing's own Strata or community title answer
// (properties.is_strata). A unit recorded as not on strata keeps its land.

export const STRATA_LAND_MAX_SQM = 500;

export const STRATA_LAND_NOT_SHOWN = "Land size not shown (likely the whole strata site)";

const STRATA_DWELLING = /\b(unit|apartment|flat|town ?house|villa|duplex|terrace)\b/i;

/** A unit, apartment, townhouse, villa, duplex or terrace, on strata. */
export function isStrataDwelling(propertyType: string | null | undefined, isStrata: boolean | null | undefined): boolean {
  return isStrata === true && STRATA_DWELLING.test(propertyType ?? "");
}

/** True when this land size is not to be shown or used. */
export function strataLandHidden(landSizeSqm: number | null | undefined, strataDwelling: boolean): boolean {
  return strataDwelling && typeof landSizeSqm === "number" && landSizeSqm > STRATA_LAND_MAX_SQM;
}

/**
 * The row as the card, the comparison and the draft see it: a hidden land
 * size is null, and marked hidden so it is said rather than taken as missing.
 * Safe to apply twice.
 */
export function withStrataLand<T extends { landSizeSqm: number | null; landSizeHidden?: boolean }>(
  row: T,
  strataDwelling: boolean,
): T {
  if (!strataLandHidden(row.landSizeSqm, strataDwelling)) return row;
  return { ...row, landSizeSqm: null, landSizeHidden: true };
}

/** Under the land box in Edit listing details, when the figure in it is not shown or used. */
export const STRATA_LAND_FORM_NOTE =
  "Over 500 m² on a unit, townhouse or duplex on strata is likely the whole strata site, so it isn't shown or used in the comparison, the drafted reasoning or the Statement of Information. Enter the lot's own land size if you know it.";
