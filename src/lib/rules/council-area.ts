// Metro or non-metro, from the listing's council area (Reg s12A, from 17
// November 2026; Adam, 9 Nov 2026: "go ahead with metro or non-metro").
//
// Reg s12A: "metropolitan area means the local government areas of" 36 named
// councils; "non-metropolitan area means an area in the State other than a
// metropolitan area". Reg s12D(2) and (4) then set where the agent looks for
// comparable sales: within 2 km and 6 months in the metropolitan area (12 if
// fewer than 3 are comparable), within 5 km and 18 months outside it.
//
// The council area is read off the planning certificate in the contract (the
// council that issued it, s10.7 of the Environmental Planning and Assessment
// Act 1979) and asked of the agent when it can't be. It's kept on the listing
// (0118) as one of the 128 NSW council areas below, by name. Metro or
// non-metro is worked out here, never stored, so it always follows this list.

import { reformsInForce } from "@/lib/rules/underquoting-reforms";

/** Reg s12A, in the Regulation's order. The names are the plain ones people use. */
export const METRO_COUNCILS = [
  "Bayside",
  "Blacktown",
  "Blue Mountains",
  "Burwood",
  "Camden",
  "Campbelltown",
  "Canada Bay",
  "Canterbury-Bankstown",
  "Central Coast",
  "Newcastle",
  "City of Sydney",
  "Wollongong",
  "Cumberland",
  "Fairfield",
  "Georges River",
  "Hawkesbury",
  "Hornsby",
  "Hunters Hill",
  "Inner West",
  "Ku-ring-gai",
  "Lane Cove",
  "Liverpool",
  "Mosman",
  "North Sydney",
  "Northern Beaches",
  "Parramatta",
  "Penrith",
  "Randwick",
  "Ryde",
  "Strathfield",
  "Sutherland",
  "The Hills",
  "Waverley",
  "Willoughby",
  "Wollondilly",
  "Woollahra",
] as const;

/** Every other NSW council area: the non-metropolitan area (Reg s12A). */
export const OTHER_NSW_COUNCILS = [
  "Albury",
  "Armidale",
  "Ballina",
  "Balranald",
  "Bathurst",
  "Bega Valley",
  "Bellingen",
  "Berrigan",
  "Bland",
  "Blayney",
  "Bogan",
  "Bourke",
  "Brewarrina",
  "Broken Hill",
  "Byron",
  "Cabonne",
  "Carrathool",
  "Central Darling",
  "Cessnock",
  "Clarence Valley",
  "Cobar",
  "Coffs Harbour",
  "Coolamon",
  "Coonamble",
  "Cootamundra-Gundagai",
  "Cowra",
  "Dubbo",
  "Dungog",
  "Edward River",
  "Eurobodalla",
  "Federation",
  "Forbes",
  "Gilgandra",
  "Glen Innes Severn",
  "Goulburn Mulwaree",
  "Greater Hume",
  "Griffith",
  "Gunnedah",
  "Gwydir",
  "Hay",
  "Hilltops",
  "Inverell",
  "Junee",
  "Kempsey",
  "Kiama",
  "Kyogle",
  "Lachlan",
  "Lake Macquarie",
  "Leeton",
  "Lismore",
  "Lithgow",
  "Liverpool Plains",
  "Lockhart",
  "Maitland",
  "MidCoast",
  "Mid-Western",
  "Moree Plains",
  "Murray River",
  "Murrumbidgee",
  "Muswellbrook",
  "Nambucca Valley",
  "Narrabri",
  "Narrandera",
  "Narromine",
  "Oberon",
  "Orange",
  "Parkes",
  "Port Macquarie-Hastings",
  "Port Stephens",
  "Queanbeyan-Palerang",
  "Richmond Valley",
  "Shellharbour",
  "Shoalhaven",
  "Singleton",
  "Snowy Monaro",
  "Snowy Valleys",
  "Tamworth",
  "Temora",
  "Tenterfield",
  "Tweed",
  "Upper Hunter",
  "Upper Lachlan",
  "Uralla",
  "Wagga Wagga",
  "Walcha",
  "Walgett",
  "Warren",
  "Warrumbungle",
  "Weddin",
  "Wentworth",
  "Wingecarribee",
  "Yass Valley",
] as const;

export type CouncilArea = (typeof METRO_COUNCILS)[number] | (typeof OTHER_NSW_COUNCILS)[number];
export type AreaKind = "metro" | "non_metro";
/** Where a listing's council area came from (0118). */
export type CouncilAreaFrom = "planning_certificate" | "agent";

// Words a council's own name carries that aren't part of which council it
// is: "Hornsby Shire Council", "The Council of the City of Ryde",
// "Woollahra Municipal Council", "Armidale Regional Council".
const NOT_THE_NAME = new Set(["the", "of", "council", "city", "shire", "municipal", "municipality", "regional", "lga", "local", "government", "area"]);

/** A council's name reduced to the part that says which one it is. */
function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .split(/[^a-z]+/)
    .filter((w) => w && !NOT_THE_NAME.has(w))
    .join("");
}

const BY_KEY = new Map<string, CouncilArea>(
  [...METRO_COUNCILS, ...OTHER_NSW_COUNCILS].map((c) => [keyOf(c), c as CouncilArea]),
);
const METRO = new Set<string>(METRO_COUNCILS);

/** One of the 128 council areas, exactly as listed here. */
export function isCouncilArea(name: unknown): name is CouncilArea {
  return typeof name === "string" && BY_KEY.get(keyOf(name)) === name;
}

/**
 * The council area a printed name means, such as the council named on a
 * planning certificate ("Hornsby Shire Council" is Hornsby). Null when it
 * isn't one of them: then the agent is asked, rather than this guessing.
 */
export function councilAreaFrom(printed: string | null | undefined): CouncilArea | null {
  if (!printed || !printed.trim()) return null;
  return BY_KEY.get(keyOf(printed)) ?? null;
}

/** Metro or non-metro (Reg s12A). Null with no council area. */
export function areaOf(council: string | null | undefined): AreaKind | null {
  if (!council || !isCouncilArea(council)) return null;
  return METRO.has(council) ? "metro" : "non_metro";
}

export const COUNCIL_AREA_LABEL = "Council area";
export const COUNCIL_AREA_QUESTION = "Which council area is the property in?";
export const COUNCIL_AREA_HINT =
  "It's on the planning certificate in the contract for sale. It decides how far, and how far back, to look for comparable sales (Reg s12D).";
export const COUNCIL_AREA_MISSING = "Choose the council area from the list.";

/** "a metropolitan area" or "a non-metropolitan area", as Reg s12A puts it. */
export function areaName(kind: AreaKind): string {
  return kind === "metro" ? "a metropolitan area" : "a non-metropolitan area";
}

/** Where to look for comparable sales (Reg s12D(2) and (4)), which starts on 17 November 2026. */
export function searchAreaLine(kind: AreaKind, now: Date = new Date()): string {
  const look =
    kind === "metro"
      ? "look for comparable sales within 2 km, sold in the last 6 months. If fewer than 3 of those are comparable, also look at sales within 2 km in the last 12 months (Reg s12D)."
      : "look for comparable sales within 5 km, sold in the last 18 months (Reg s12D).";
  return reformsInForce(now) ? `${look[0].toUpperCase()}${look.slice(1)}` : `From 17 November 2026, ${look}`;
}

/** "Hornsby, a metropolitan area (Reg s12A)." */
export function councilAreaSummary(council: string): string | null {
  const kind = areaOf(council);
  return kind ? `${council}, ${areaName(kind)} (Reg s12A).` : null;
}

/** Where it came from, in words: "Read from the planning certificate in the contract." */
export function councilAreaSource(from: CouncilAreaFrom | null | undefined, setByName: string | null, setOn: string | null): string {
  if (from === "planning_certificate") return "Read from the planning certificate in the contract.";
  if (setByName && setOn) return `Chosen by ${setByName} on ${setOn}.`;
  if (setByName) return `Chosen by ${setByName}.`;
  return "Chosen in RealComply.";
}

/** The compliance record's lines (the a4c card): the council area, then where to look. */
export function councilAreaRecordLines(
  args: {
    council: string | null | undefined;
    from: CouncilAreaFrom | null | undefined;
    setByName: string | null;
    setOn: string | null;
  },
  now: Date = new Date(),
): string[] {
  const kind = areaOf(args.council);
  if (!args.council || !kind) return [`${COUNCIL_AREA_LABEL}: not recorded.`];
  return [
    `${COUNCIL_AREA_LABEL}: ${councilAreaSummary(args.council)} ${councilAreaSource(args.from, args.setByName, args.setOn)}`,
    searchAreaLine(kind, now),
  ];
}
