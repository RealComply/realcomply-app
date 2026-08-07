// RealComply — NSW residential sales rules (v1, Cass Property binding)
//
// This is the "legal layer + one agency's binding," collapsed into a single
// file for now — see RealComply-rules-schema.md for the full three-layer
// design (legal layer / agency binding / engine). Building the general
// multi-tenant binding system is a productisation-phase concern; this file
// is deliberately the *content* for the one binding that exists today
// (Cass Property, NSW), kept separate from the engine/UI code so the seam
// is still there when it's time to generalise.
//
// Item keys mostly match the ones already used in the clickable prototype
// (realcomply-prototype.html, see RealComply-prototype-build-log.md) so the
// two stay easy to cross-reference: a1–a7/a4b/a4c, t1–t4, amv/amp, c1–c3,
// d1–d3, e1, amc, f0–f2, sign_agent/sign_licensee, send_licensee.
//
// Source of truth for the obligation wording/citations:
// RealComply-NSW-sales-obligation-register.md and
// RealComply-listing-lifecycle-stage-map.md (both in the project docs).

import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

export type ItemKind =
  | "checklist" // confirm/done/flag, optional note + agent-asserted date
  | "guide" // advertised price guide vs ESP live underquoting check
  | "offers" // offers log (repeating entries)
  | "review" // ESP review log (repeating entries)
  | "reduction" // price reduction / revise-ESP workflow
  | "quotes" // verbal price-quote log (repeating entries) — the written record of a verbal price statement
  | "sale" // final sale price + ESP-diff check
  | "reports" // pest & building / strata report register (repeating entries)
  | "export" // generate the finalised compliance file
  | "sign" // typed-signature attestation
  | "send"; // hand-off to the licensee

export type ComplianceItem = {
  key: string;
  stage: PropertyStage;
  kind: ItemKind;
  label: string;
  description: string;
  legalBasis?: string;
  licenseeOnly?: boolean;
  requiresDate?: boolean;
  requiredForStageCompletion: boolean;
  // Second argument gives a conditional item visibility into ANOTHER item's
  // recorded data (not just the property's own setup fields) — e.g. e2
  // below only appears once a7 records that a material fact was actually
  // disclosed, not just that the vendor was asked. Keyed by item_key, same
  // shape as the allItems maps already built in every page that calls this.
  showIf?: (property: Property, allItems: Record<string, PropertyItem>) => boolean;
  // Suppresses the free-text note box on the item card — for items that are
  // self-explanatory yes/done confirmations, where a note is unnecessary
  // extra work rather than useful evidence.
  hideNote?: boolean;
  // Replaces the note box with a read-only "Findings" line instead of
  // hiding it outright — for items where the box was never meant for the
  // agent to type into, only to surface what AI extraction found (e.g. a
  // s52A index/annexure mismatch). Shows "None" rather than staying blank
  // when there's nothing to report, so it's clear the AI looked and found
  // nothing rather than that nobody's looked yet.
  showFindings?: boolean;
  // Suppresses the "Evidence" attach-a-file control on the item card — for
  // items that are themselves an attestation/action (a typed signature, a
  // hand-off to the licensee), not a claim that needs a supporting document.
  hideEvidence?: boolean;
};

const items: ComplianceItem[] = [
  // ── Stage 0 — Listing set-up ──────────────────────────────────────────
  {
    key: "a1",
    stage: 0,
    kind: "checklist",
    label: "Vendor identity & ownership verified",
    description:
      "Identity verified for every vendor (+ any beneficial owner) and confirmed they own what they're selling. This happens externally as part of your AML/CTF customer due diligence — the confirmation is registered with AUSTRAC there, not stored here. Just confirm it's been done.",
    legalBasis: "Rules of Conduct Sch 1",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideNote: true,
    hideEvidence: true,
  },
  {
    key: "a2",
    stage: 0,
    kind: "checklist",
    label: "Approved consumer guide given before the agreement was signed",
    description:
      "The approved guide must be given to the vendor before the agency agreement is signed, and no more than 1 month before signing.",
    legalBasis: "s56, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: true,
    requiredForStageCompletion: true,
  },
  {
    key: "a3",
    stage: 0,
    kind: "checklist",
    label: "Agency agreement signed; copy served within 48 hours",
    description:
      "A signed copy of the agency agreement must be given to the vendor within 48 hours of signing.",
    legalBasis: "s55, Property and Stock Agents Act 2002 (NSW); Sch 1 r16",
    requiresDate: true,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a4",
    stage: 0,
    kind: "checklist",
    label: "Estimated selling price (ESP) recorded",
    description:
      "Record the ESP in the agency agreement — a single figure, or a range with a spread no greater than 10%.",
    legalBasis: "s72A, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a4b",
    stage: 0,
    kind: "checklist",
    label: "Comparable-sales evidence held",
    description:
      "Confirm comparable-sales evidence sits behind the ESP — either bundled with the agency agreement, or attached/filed separately. Note where it's held.",
    legalBasis: "s72A + NSW Fair Trading underquoting guidance",
    requiresDate: false,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a4c",
    stage: 0,
    kind: "checklist",
    label: "ESP reasoning recorded",
    description:
      "In your own words, note how this property sits against the comparables and how you arrived at the ESP. This is your record of how the estimate was formed, not a black-letter requirement to justify every difference.",
    legalBasis: "s72A (evidence of how the estimate was formed)",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "a5",
    stage: 0,
    kind: "checklist",
    label: "Commission, rebates & VPA disclosed",
    description:
      "Commission/rebate disclosure to the vendor, and any vendor-paid advertising authorised in writing.",
    legalBasis: "s57, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a6",
    stage: 0,
    kind: "checklist",
    label: "Cooling-off status recorded",
    description: "Agency-agreement cooling-off (1 business day) acknowledged.",
    legalBasis: "Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a7",
    stage: 0,
    kind: "checklist",
    label: "Material facts identified",
    description:
      "Ask the vendor about prescribed material facts (flood/bushfire history, loose-fill asbestos, prior known defects, etc.) and record the answer — even if it's \"none disclosed.\"",
    legalBasis: "Reg 60, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showFindings: true,
  },
  {
    key: "a8",
    stage: 0,
    kind: "checklist",
    label: "Agent's interest disclosed & consented (s49)",
    description:
      "You (or a related party) may obtain a beneficial interest in this property. Before that happens, the vendor must give written consent on the approved s49 form — and a separate written consent if you'll still be paid commission on the sale.",
    legalBasis: "s49, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.agent_interest),
    hideNote: true,
  },
  {
    key: "amv",
    stage: 0,
    kind: "checklist",
    label: "Vendor AML check (via your provider)",
    description:
      "RealComply doesn't perform AML/CDD — your provider (e.g. PEXA Clear) does. Confirm CDD has been completed for the vendor(s) and note the reference/outcome pointer.",
    legalBasis: "AML/CTF Act 2006 (Cth), Tranche 2",
    requiresDate: false,
    requiredForStageCompletion: true,
  },

  // ── Stage 1 — Pre-market ──────────────────────────────────────────────
  {
    key: "b1",
    stage: 1,
    kind: "checklist",
    label: "Contract of sale prepared with prescribed documents",
    description:
      "Contract available before marketing, with the s52A prescribed documents attached (planning certificate, sewer diagram, title/plan).",
    legalBasis: "s52A, Conveyancing Act 1919 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideNote: true,
    showFindings: true,
  },
  {
    key: "b2",
    stage: 1,
    kind: "checklist",
    label: "Pool compliance certificate",
    description:
      "A pool safety certificate is required in the contract — unless the pool is common property in a strata scheme of more than 2 lots (owners corporation handles compliance). If strata, confirm which applies: certificate held, or the exemption applies because it's common property in a scheme of more than 2 lots.",
    legalBasis: "Swimming Pools Act 1992 (NSW); Conveyancing (Sale of Land) Regulation",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.has_pool),
  },
  {
    key: "t1",
    stage: 1,
    kind: "checklist",
    label: "Managing agent notified of sale",
    description: "Notify the property's managing agent that it's being sold.",
    legalBasis: "Sch 2 r7, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.is_tenanted),
    hideNote: true,
  },
  {
    key: "t2",
    stage: 1,
    kind: "checklist",
    label: "Written notice of sale given to tenant",
    description:
      "Give the tenant written notice the property is for sale. The first buyer inspection can't happen until at least 14 days after this notice date.",
    legalBasis: "s53, Residential Tenancies Act 2010 (NSW)",
    requiresDate: true,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.is_tenanted),
    hideNote: true,
  },
  {
    key: "t3",
    stage: 1,
    kind: "checklist",
    label: "Inspection access arranged with tenant",
    description:
      "Try to agree inspection days/times with the tenant first. If there's no agreement, the statutory fallback applies: max twice a week, 48 hours' notice per showing, not before 8am or after 8pm, never Sundays or public holidays. Note the arrangement (e.g. \"every Saturday 10:30am\").",
    legalBasis: "s53, Residential Tenancies Act 2010 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.is_tenanted),
  },
  {
    key: "t4",
    stage: 1,
    kind: "checklist",
    label: "Lease attached to the contract for sale",
    description:
      "A tenanted sale means the lease forms part of the s52A disclosure so buyers see the terms. Confirm the lease is attached to the contract.",
    legalBasis: "s52A, Conveyancing Act 1919 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.is_tenanted),
    hideNote: true,
  },
  {
    key: "b3",
    stage: 1,
    kind: "checklist",
    label: "Vendor approved all marketing material",
    description:
      "Confirm the vendor has approved the marketing material (photos, copy, floorplan, signage) before it goes live.",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideNote: true,
  },
  {
    // Gap-analysis finding, 7 Aug 2026: the Sales File Checklist requires
    // AML red flags/EDD to be escalated to the licensee — amv (Stage 0)
    // confirms CDD happened but never asked this specifically. Placed here
    // at Pre-market rather than alongside amv/amp/amc at Stage 0/4, per
    // Adam's call — gates before marketing goes live rather than back at
    // initial listing set-up.
    key: "amr",
    stage: 1,
    kind: "checklist",
    label: "AML red flags escalated to the licensee",
    description:
      "Confirm there's nothing to escalate from the vendor AML/CTF check, or that any red flags / enhanced due diligence requirements have been raised with the licensee in charge.",
    legalBasis: "AML/CTF Act 2006 (Cth), Tranche 2",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    // Gap-analysis finding, 7 Aug 2026: appeared independently in both the
    // Sales File Checklist and the Price Representations & Material Fact
    // Checklist — "approved by the vendor AND licensee before publication."
    // b3 already covers vendor approval; this is the missing licensee half,
    // gated here so it has to happen before Stage 2 (On market) opens.
    key: "b4",
    stage: 1,
    kind: "checklist",
    label: "Licensee approved the price statement before publication",
    description:
      "The licensee in charge confirms the price statement on the marketing material (the advertised guide/range) is accurate, before it's published.",
    licenseeOnly: true,
    requiresDate: false,
    requiredForStageCompletion: true,
  },

  // ── Stage 2 — On market ───────────────────────────────────────────────
  {
    key: "c1",
    stage: 2,
    kind: "guide",
    label: "Advertised price guide vs ESP",
    description:
      "Record the advertised guide. It must not be below the ESP, must not use prohibited price terms (\"offers over\", \"O.N.O.\", etc.), and if it's a range, the spread must be ≤10%.",
    legalBasis: "s73 / s73A, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "c2",
    stage: 2,
    kind: "checklist",
    label: "Advertising identifies the licensed agent/agency",
    description: "Every ad identifies the licensed agent and agency.",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "c3",
    stage: 2,
    kind: "checklist",
    label: "Marketing reflects the agreement",
    description:
      "Marketing accurately describes the property and is consistent with the agency agreement (specs, features).",
    legalBasis: "Australian Consumer Law s18/s30",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "c4",
    stage: 2,
    kind: "checklist",
    label: "Agent's interest included in all marketing material",
    description:
      "Every advertisement and marketing piece for this listing discloses that you (or a related party) have an interest in the property, consistent with the written consent given under s49.",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (p) => Boolean(p.agent_interest),
    hideNote: true,
  },

  // ── Stage 3 — Campaign ────────────────────────────────────────────────
  {
    key: "d1",
    stage: 3,
    kind: "review",
    label: "ESP review log",
    description:
      "Log a weekly ESP review (and on triggers — a price change, a new offer, a comparable-sales report). Newest first.",
    legalBasis: "s72A review obligation",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
  {
    key: "d2",
    stage: 3,
    kind: "offers",
    label: "Offers log",
    description:
      "Every offer, presented and recorded. The vendor must be told of every offer in writing, and price can never be represented below a rejected offer once it's in writing.",
    legalBasis: "Sch 2 r5 (PSA Reg); s73A (PSA Act)",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
  {
    key: "d3",
    stage: 3,
    kind: "reduction",
    label: "Price reduction / ESP revision",
    description:
      "If the price guide or ESP changes during the campaign, log it here. An ESP revision requires written notice to the vendor and an amended agreement — RealComply tracks that this happened.",
    legalBasis: "s72A revise loop",
    requiresDate: false,
    requiredForStageCompletion: false,
  },

  // ── Stage 4 — Under offer / exchange ─────────────────────────────────
  {
    key: "e1",
    stage: 4,
    kind: "checklist",
    label: "Contract served within 2 business days of exchange",
    description:
      "Serve a copy of the contract on each party (or their solicitor) within 2 business days of exchange.",
    legalBasis: "Sch 2 r17, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: true,
    requiredForStageCompletion: true,
  },
  {
    // Gap-analysis finding, 7 Aug 2026: a7 (Stage 0) only confirms the agent
    // asked the vendor and recorded the answer — the Price Reps checklist
    // separately requires confirming the fact was actually disclosed to
    // purchasers. Only appears at all when a7 records that a material fact
    // WAS disclosed (data.materialFactDisclosed) — most files never see
    // this item, per Adam's call: "only if a material fact has been
    // disclosed by the vendor." Placed at Under offer rather than earlier,
    // since that's the point a real purchaser exists to disclose it to.
    key: "e2",
    stage: 4,
    kind: "checklist",
    label: "Material facts disclosed to the purchaser(s)",
    description:
      "A material fact was recorded against this listing at a7 — confirm it's actually been disclosed to the purchaser(s), not just recorded from the vendor.",
    legalBasis: "Reg 60, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    showIf: (_p, allItems) => Boolean((allItems["a7"]?.data as { materialFactDisclosed?: boolean } | undefined)?.materialFactDisclosed),
  },
  {
    key: "amp",
    stage: 4,
    kind: "checklist",
    label: "Purchaser AML check (via your provider)",
    description:
      "Confirm CDD has been completed for the purchaser(s) (+ any beneficial owner) via your AML provider, and note the reference/outcome pointer.",
    legalBasis: "AML/CTF Act 2006 (Cth), Tranche 2",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "amc",
    stage: 4,
    kind: "checklist",
    label: "AML COMPLETE — licensee sign-off",
    description:
      "Confirms CDD is complete on both the vendor and the purchaser. This must be signed off by the licensee in charge — never the sales agent, never auto-ticked. The AML/CTF compliance officer must be a named human.",
    legalBasis: "AML/CTF Act 2006 (Cth)",
    licenseeOnly: true,
    requiresDate: false,
    requiredForStageCompletion: true,
  },

  // ── Stage 5 — Settled ─────────────────────────────────────────────────
  {
    // Gap-analysis finding, 7 Aug 2026: the Price Reps checklist requires
    // every price statement made "in the course of marketing" to be
    // recorded in writing — including a verbal figure given at an open
    // home. Logging an entry here IS that written record. Originally gated
    // at Pre-market; moved to Settlement per Adam's follow-up call, so the
    // log is finalised alongside the rest of the closing paperwork rather
    // than being locked in before the campaign even starts.
    key: "b5",
    stage: 5,
    kind: "quotes",
    label: "Verbal price-quote log",
    description:
      "Every verbal price statement made to a prospective purchaser, written down here — the written record the Act requires. Log one now if you've already given a figure verbally, or confirm there's nothing to log yet.",
    legalBasis: "Price Representations & Material Fact Checklist — price statements recorded in writing",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "f0",
    stage: 5,
    kind: "sale",
    label: "Final sale price",
    description:
      "Record the final sale price. If it lands outside the ESP range, that's flagged for evidence-of-reasonableness — point to the ESP revision log / Change of ESP form if the price moved during the campaign.",
    legalBasis: "s72A",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "f3",
    stage: 5,
    kind: "reports",
    label: "Pre-purchase inspection report register",
    description:
      "Upload every building, pest, or strata report you're aware of for this property — the details cl 37 requires are read straight off the document, and you'll be shown anything it flags as missing. You must be able to show this register to anyone who asks for a copy of the contract for sale. Not every sale will have entries — that's a valid, normal outcome.",
    legalBasis: "cl 37, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
  {
    key: "f1",
    stage: 5,
    kind: "checklist",
    label: "Compliance file signed off by the licensee",
    description:
      "Confirms the licensee has reviewed the file and everything required is complete.",
    licenseeOnly: true,
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "sign_agent",
    stage: 5,
    kind: "sign",
    label: "Agent signature",
    description: "Type your name to adopt it as your signature on this file.",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideEvidence: true,
  },
  {
    key: "send_licensee",
    stage: 5,
    kind: "send",
    label: "Send to licensee",
    description:
      "Hand the file to the licensee for sign-off. (Email delivery isn't wired up yet — let your licensee know directly that it's ready.)",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideEvidence: true,
  },
  {
    key: "sign_licensee",
    stage: 5,
    kind: "sign",
    label: "Licensee signature",
    description: "The licensee in charge types their name to adopt it as their signature.",
    licenseeOnly: true,
    hideEvidence: true,
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "f2",
    stage: 5,
    kind: "export",
    label: "Generate finalised compliance file",
    description:
      "Generates the finalised, read-only compliance record for this file. (A polished branded PDF export is a follow-up — this produces a printable summary today.)",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
];

// Server components pass ComplianceItem objects straight into client
// components (ItemCard). `showIf` is a function and functions can't cross
// the server/client boundary — strip it once filtering is done so callers
// always get a plain, serializable object.
function stripShowIf(item: ComplianceItem): ComplianceItem {
  const { showIf: _showIf, ...rest } = item;
  return rest;
}

export function itemsForStage(
  stage: PropertyStage,
  property: Property,
  allItems: Record<string, PropertyItem> = {},
): ComplianceItem[] {
  return items
    .filter((item) => item.stage === stage)
    .filter((item) => (item.showIf ? item.showIf(property, allItems) : true))
    .map(stripShowIf);
}

export function allItemsFor(property: Property, allItems: Record<string, PropertyItem> = {}): ComplianceItem[] {
  return items.filter((item) => (item.showIf ? item.showIf(property, allItems) : true)).map(stripShowIf);
}

export function getItem(key: string): ComplianceItem | undefined {
  return items.find((item) => item.key === key);
}
