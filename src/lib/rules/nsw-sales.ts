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
  // a3 (signed agreement) leads the stage — Adam wants it front and centre
  // since it's the item agents actually chase down first in practice, ahead
  // of the AML/consumer-guide housekeeping items that used to precede it.
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
    key: "a1",
    stage: 0,
    kind: "checklist",
    label: "Vendor identity verified",
    // Rewritten 17 Aug 2026 after Adam caught two errors in the old wording.
    //
    // It said this "happens externally as part of your AML/CTF customer due
    // diligence — the confirmation is registered with AUSTRAC there". Both
    // halves were wrong. AUSTRAC receives suspicious matter and threshold
    // transaction reports; routine CDD outcomes are never sent to it. And
    // folding a state obligation into a federal one is the wrong regulator
    // and the wrong purpose: CDD establishes who your CUSTOMER is, it does
    // not establish who owns the land. A clean CDD result on someone with no
    // right to sell is exactly the title-fraud case this check exists for.
    //
    // "& ownership" also dropped from the label. Bundling identity and title
    // into one tick was the original error; ownership is a separate question
    // and is tracked as an open gap rather than pretended away here.
    //
    // legalBasis narrowed from the vague "Rules of Conduct Sch 1". There is
    // no express vendor-VOI provision in the PSA Act or Regulation — the duty
    // is carried by Sch 1 r4 (skill, care and diligence) and r8 (an agent
    // must not act without the person's written authority, which presupposes
    // knowing who that person is). The formal VOI regime under the
    // Conveyancing Rules binds the lodging solicitor/conveyancer, not the
    // agent. Citing a provision that does not exist inflates the obligation,
    // which the product philosophy treats as worse than omitting a feature.
    description:
      "Identity confirmed for every vendor before you acted on the sale. Separate from your AML/CTF check — that identifies your customer, it doesn't confirm who owns the land. No ID copies are kept here.",
    legalBasis: "Sch 1 rr 4 & 8, Property and Stock Agents Regulation 2022 (NSW)",
    // Now dated. The date is the point of the record: it evidences that
    // verification happened before the agent acted, not merely that someone
    // ticked a box at some later time. Also what lets the AI fill this in
    // from the agreement without the agent re-keying anything.
    requiresDate: true,
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
    // No note box (Adam, 14 Aug 2026): this is a plain yes-or-no with a date.
    // Either the guide was given before signing or it wasn't, and the date is
    // the thing that proves it — s56 turns on timing, since the guide must be
    // given before the agreement is signed and no more than a month before.
    // A free-text box invites commentary that adds nothing to that.
    hideNote: true,
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
    // No findings box and no note (Adam, 15 Aug 2026). The AI's job here is to
    // read the two figures off the agreement and nothing else. It had written
    // "PropTrack automated sale estimate range shown, not necessarily the
    // agent's own appraisal figure" — which was simply untrue of the document,
    // an invented provenance claim sitting beside a number the agent has to
    // defend under s72A. Worse than restatement, because a reader cannot tell
    // it is wrong.
    //
    // The one thing genuinely worth saying about a range is whether it breaches
    // the 10% spread, and that is arithmetic. It is computed from the figures
    // (live in ItemCard, authoritatively on save in setItemStatus) rather than
    // described by a model, so it cannot be wrong and cannot drift.
    hideNote: true,
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
    // No attachment here. The evidence for the ESP reasoning is the
    // comparable-sales report, which is already attached to a4b directly
    // above — asking for a second upload on the reasoning itself invites the
    // same file twice and makes the card look incomplete when it is not
    // (Adam, 15 Aug 2026).
    hideEvidence: true,
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
    // The disclosure lives inside the signed agency agreement, which is
    // attached to a3. Nothing separate exists to upload (Adam, 15 Aug 2026).
    hideEvidence: true,
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
    // Also inside the signed agency agreement, same as a5 (Adam, 15 Aug 2026).
    hideEvidence: true,
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
    label: "Vendor check with your AML provider",
    // Plain English, 17 Aug 2026. The old wording ran three pieces of jargon
    // together — "AML/CDD", "CDD has been completed", "reference/outcome
    // pointer" — and Adam, a licensee, had to ask what CDD meant. If he had
    // to ask, an agent certainly would.
    //
    // PEXA Clear removed. Naming Cass's provider inside a rule is exactly the
    // hard-coding the REINSW forms mapping flagged as a hit on the separable
    // rules layer: an agency using a different provider reads a rule that
    // names a competitor's product.
    description:
      "Run each vendor through your AML provider and note the reference. RealComply doesn't do the check itself.",
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
    // The document list itself lives in nsw-prescribed-documents.ts, built
    // from Sch 1 Pt 1 of the Conveyancing (Sale of Land) Regulation 2022 and
    // varied by whether the listing is strata. Not repeated here: naming three
    // of them in this description was how the list quietly stayed at three.
    description:
      "Contract available before marketing, with the s52A prescribed documents attached. Attach the contract and the documents are checked off one by one.",
    legalBasis: "s52A, Conveyancing Act 1919 (NSW); Conveyancing (Sale of Land) Regulation 2022, Sch 1",
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
    // Exemption source: Conveyancing (Sale of Land) Regulation 2022, Sch 1
    // item 15(2). Corrected 15 Aug 2026 — the wording said "strata scheme"
    // where item 15(2)(a) reads "a lot in a strata scheme or in a community
    // scheme". A pool in a community-title estate was being asked for a
    // certificate the Regulation does not require there.
    //
    // TWO THINGS THIS DELIBERATELY DOES NOT DO, both because loosening a
    // requirement wrongly means a contract goes out without a certificate that
    // was required, and the purchaser gets a right to rescind:
    //   - Item 15(2)(a) as written exempts any lot in a scheme of more than 2
    //     lots, without distinguishing a pool on common property from one on
    //     the individual lot. The wording below keeps the common-property
    //     qualifier, so the app asks in a case the Regulation may not require.
    //     Raised with Adam 15 Aug 2026 to put to the compliance adviser before
    //     it is relaxed.
    //   - Item 15(2)(b) also exempts off-the-plan contracts. Not reflected
    //     here because off-the-plan sales are out of scope for this ruleset;
    //     they need their own items (disclosure statement, Sch 1 Pt 2), not a
    //     clause bolted onto this one.
    description:
      "A pool safety certificate is required in the contract for a pool on the land being sold.",
    legalBasis:
      "Swimming Pools Act 1992 (NSW); Conveyancing (Sale of Land) Regulation 2022, Sch 1 item 15",
    requiresDate: false,
    requiredForStageCompletion: true,
    // Single-lot properties only (Adam, 15 Aug 2026). A pool in a unit block or
    // a townhouse complex is the owners corporation's compliance problem, not
    // the selling agent's, and item 15(2)(a) exempts the contract, so asking
    // the question at all only invited a wrong answer.
    //
    // The narrow case this gives up: item 15(2)(a) exempts a scheme of MORE
    // THAN 2 lots, so a 2-lot strata with a shared pool does still need the
    // certificate and will no longer be asked. Raised with Adam, who took the
    // trade knowingly. Reinstating it needs a lot count at property setup,
    // which is a question every strata listing would answer to catch a case
    // that is close to hypothetical.
    //
    // is_strata is nullable, and null falls through to showing the item. That
    // is the right way round: an unanswered question should surface the
    // certificate check, not silently skip it.
    showIf: (p) => Boolean(p.has_pool) && !p.is_strata,
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
      "Confirm the vendor check threw up nothing that needs escalating — or that anything it did throw up has been raised with the licensee in charge.",
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
  // No ESP review-log item here, deliberately (Adam, 13 Aug 2026). s72A(3)
  // imposes a *substantive* duty — the ESP "is, and remains" a reasonable
  // estimate — not a documentation duty. The Act's record obligations are
  // triggered only on revision: s72A(4)(a) written notice of the revised ESP
  // to the vendor, s72A(4)(b) amending the agency agreement, and s72A(5)
  // evidence of reasonableness given to the seller when specifying OR
  // revising. Nothing requires logging a review that concluded the estimate
  // still held, so the app no longer asks for one — the previous item cited
  // a "s72A review obligation" that does not exist, which overstates the law
  // in a product whose defence depends on citing it accurately. Revisions
  // are captured by d3 below.
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
      "If the price guide or ESP changes during the campaign, log it here. Revising an ESP is where the Act's record obligations actually bite: written notice of the revised ESP to the vendor, an amended agency agreement, and evidence of the new price's reasonableness given to the seller.",
    legalBasis: "s72A(4)(a)-(b), s72A(5), Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
  },

  // ── Stage 4 — Sold (exchanged) ────────────────────────────────────────
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
    // disclosed by the vendor." Placed at Sold rather than earlier,
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
  // The two purchaser-side AML items, at Sold (Adam, 17 Aug 2026).
  //
  // They spent a few hours at Settled. He first said the purchaser check was
  // premature at "Under offer" and belonged after unconditional exchange —
  // correct, and for a good reason: an accepted offer is not a transaction,
  // cooling off runs and finance falls through, so checking every hopeful
  // purchaser means paying for and holding personal information about people
  // who never buy anything.
  //
  // The real problem was the STAGE NAME, not the placement. "Under offer"
  // described an accepted offer; the stage actually starts at exchange. Once
  // it was renamed "Sold" — and Adam confirmed his files reach it unconditional
  // — this became its correct home, and Settled was simply late.
  {
    key: "amp",
    stage: 4,
    kind: "checklist",
    label: "Purchaser check with your AML provider",
    description:
      "Now the property is sold, run each purchaser through your AML provider and note the reference.",
    legalBasis: "AML/CTF Act 2006 (Cth), Tranche 2",
    requiresDate: false,
    requiredForStageCompletion: true,
  },
  {
    key: "amc",
    // Follows amp. This confirms the position on BOTH parties, so it cannot
    // sit a stage earlier than the purchaser item it depends on.
    stage: 4,
    kind: "checklist",
    label: "AML COMPLETE — licensee sign-off",
    // Wording widened 17 Aug 2026. It used to say flatly that CDD is complete
    // on both parties, which stops being true the moment a vendor is closed as
    // a pre-commencement customer — and asking the licensee to attest to
    // something the file itself contradicts is worse than asking nothing.
    // "Properly dealt with" covers both endings; the file shows which one, and
    // the licensee is the person who reads it.
    description:
      "Confirms the AML position is properly dealt with for both the vendor and the purchaser — checked with your provider, or, for a vendor under an agreement predating 1 July 2026, recorded as a pre-commencement customer. This must be signed off by the licensee in charge — never the sales agent, never auto-ticked. The AML compliance officer must be a named human.",
    legalBasis: "AML/CTF Act 2006 (Cth)",
    licenseeOnly: true,
    requiresDate: false,
    requiredForStageCompletion: true,
  },

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

/**
 * Every item in the ruleset, unconditionally — including the ones that only
 * appear on a strata listing, a tenanted one, or a listing with a pool.
 *
 * Used by the help assistant (src/lib/help/product-guide.ts), which has to
 * describe the product as a whole rather than one property's file. Everything
 * else should keep using allItemsFor/itemsForStage, which filter to what an
 * actual listing shows — this is the one legitimate reason to want the raw
 * set, and taking it from here means the help answers cannot drift out of
 * step with what the app really does.
 */
export function allItemsInRuleset(): ComplianceItem[] {
  return items.map(stripShowIf);
}

export function getItem(key: string): ComplianceItem | undefined {
  return items.find((item) => item.key === key);
}
