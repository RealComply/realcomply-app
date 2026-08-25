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

import type { AuctionOutcomeData, Property, PropertyItem, PropertyStage } from "@/lib/types";

// ── Auction visibility ──────────────────────────────────────────────────────
// Every x-series item is conditional on the listing being an auction. The trap
// is the pass-in that continues as a private treaty sale, which is completely
// normal: the moment sale_method flips, a naive showIf hides every auction
// item AND the evidence attached to them — precisely the wrong behaviour for a
// compliance record. So the test is "is an auction, OR has ever recorded
// anything against an auction item". The campaign WAS an auction; that is a
// fact about the file and it does not stop being true.
export const AUCTION_ITEM_KEYS = ["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8", "x9", "x10"] as const;

// The subset that belongs to the day itself, in the order they happen. The
// property page groups these into the auction-day sheet.
export const AUCTION_DAY_KEYS = ["x4", "x5", "x6", "x3", "x7", "x8", "x9", "x10"] as const;

function isAuctionFile(property: Property, allItems: Record<string, PropertyItem>): boolean {
  if (property.sale_method === "auction") return true;
  return AUCTION_ITEM_KEYS.some((key) => allItems[key] != null);
}

function auctionOutcome(allItems: Record<string, PropertyItem>): AuctionOutcomeData {
  return (allItems["x8"]?.data ?? {}) as AuctionOutcomeData;
}

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
  | "send" // hand-off to the licensee
  | "auctioneer" // who is calling the auction — name, licence no., business address
  | "reserve" // the reserve, the time it was given, and the written evidence
  | "auction"; // the outcome at the fall of the hammer

// Facts a rule may need that are not on the property row and not in its items.
//
// Threaded through rather than looked up inside the rules file, which has no
// database access by design — that separation is what lets the rules layer be
// swapped per state later (see RealComply-rules-schema.md).
export type RuleContext = {
  /**
   * Whether the agent this listing belongs to IS the agency's licensee in
   * charge.
   *
   * A FACT ABOUT THE FILE, deliberately, not about who is looking at it.
   * Hiding a card from a particular viewer would leave the file still waiting
   * on an item that viewer cannot see, which is the worst kind of blocker.
   * Everyone who opens this listing sees the same cards, and the
   * stage-completion check agrees with what is on screen.
   */
  agentIsLicensee?: boolean;
};

export type ComplianceItem = {
  key: string;
  stage: PropertyStage;
  kind: ItemKind;
  label: string;
  description: string;
  legalBasis?: string;
  licenseeOnly?: boolean;
  requiresDate?: boolean;
  /**
   * Replaces the generic "Event date" heading. Worth setting wherever the date
   * means something specific: "Event date" on a contract card does not tell the
   * agent whether we want the date it was prepared, received, or served, and
   * three agents will answer three different questions.
   */
  dateLabel?: string;
  requiredForStageCompletion: boolean;
  // Second argument gives a conditional item visibility into ANOTHER item's
  // recorded data (not just the property's own setup fields) — e.g. e2
  // below only appears once a7 records that a material fact was actually
  // disclosed, not just that the vendor was asked. Keyed by item_key, same
  // shape as the allItems maps already built in every page that calls this.
  showIf?: (
    property: Property,
    allItems: Record<string, PropertyItem>,
    ctx?: RuleContext,
  ) => boolean;
  // Suppresses the free-text note box on the item card — for items that are
  // self-explanatory yes/done confirmations, where a note is unnecessary
  // extra work rather than useful evidence.
  hideNote?: boolean;
  // The opposite: the note IS the record, so the item cannot be marked done
  // without it. For an attestation that something was approved, the note
  // carries WHAT was approved — without it the tick asserts a check happened
  // and preserves nothing about what was checked.
  //
  // Enforced server-side in setItemStatus, not just in the form.
  requiresNote?: boolean;
  // Replaces the generic "Note" heading, and gives the box a prompt. Worth
  // having wherever requiresNote is set: "Note" tells someone to write
  // something, not what to write.
  noteLabel?: string;
  notePlaceholder?: string;
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
  // Renames the "Evidence" heading on the upload control, where the generic
  // word is too vague to tell the agent WHICH document belongs there.
  evidenceLabel?: string;
  // A short caution rendered above the upload control. Used where the wrong
  // file being attached carries a consequence beyond untidiness — a1, where
  // it would mean identity documents landing in storage.
  evidenceWarning?: string;
  // Offer Replace instead of Remove on an already-attached file. Set on the
  // three documents collected at listing setup (a3, b1, a4), which are
  // mandatory there: a listing cannot be created without them, so allowing
  // them to be removed to nothing afterwards puts the file in a state the
  // setup form would have refused. Swapping one is a correction; deleting one
  // is a hole. Adam, 22 Aug 2026, on the merged ESP card: "there's no card
  // needed with no report attached because the report needs to be attached in
  // order to set up the listing."
  evidenceReplaceOnly?: boolean;
  // Screens the attachment and refuses it if it is a copy of someone's ID.
  // The warning above is words; this is the control. See screenForIdDocument
  // in lib/actions/extraction.ts for what it does and does not catch.
  rejectIdDocuments?: boolean;
  // Hides the upload control once the uploaded documents have already proved
  // this item, so the card stops asking for something it has.
  //
  // Adam, 20 Aug 2026, on a2: "it should only activate that attach evidence
  // feature if it is not already being confirmed within the agency agreement.
  // Most agency agreements, all that I've seen, have a box that is ticked that
  // the vendor signs off on confirming that they received a copy."
  //
  // This is the "forms are an index to evidence" principle applied to the
  // upload control itself: where the agreement IS the evidence, asking for a
  // second copy of it is the re-tick the product exists to remove. Never hides
  // a file already attached — see ItemShell.
  hideEvidenceWhen?: (current?: PropertyItem) => boolean;
};

// The shape extraction leaves on an item, for the hideEvidenceWhen predicates
// below. Kept narrow on purpose: a rule should be able to ask "did the
// documents settle this?" without knowing how extraction stores anything else.
type ExtractionDraft = {
  consumerGuideProvided?: boolean;
  identityVerified?: boolean;
};

function aiDraft(current?: PropertyItem): ExtractionDraft {
  return ((current?.data as { aiDraft?: ExtractionDraft } | undefined)?.aiDraft ?? {}) as ExtractionDraft;
}

// t1. The agent's own answer, not the AI's — nobody but the agency knows
// whether the agency also manages the property, and there is no document that
// says so. Saved by setItemStatus, read here and by ItemCard.
export function selfManaged(current?: PropertyItem): boolean {
  return (current?.data as { selfManaged?: boolean } | undefined)?.selfManaged === true;
}

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
    evidenceReplaceOnly: true,
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
      "Identity confirmed for every vendor before you acted on the sale. Separate from your AML/CTF check — that identifies your customer, it doesn't confirm who owns the land.",
    legalBasis: "Sch 1 rr 4 & 8, Property and Stock Agents Regulation 2022 (NSW)",
    // Now dated. The date is the point of the record: it evidences that
    // verification happened before the agent acted, not merely that someone
    // ticked a box at some later time. Also what lets the AI fill this in
    // from the agreement without the agent re-keying anything.
    requiresDate: true,
    requiredForStageCompletion: true,
    hideNote: true,
    // Upload TURNED ON 20 Aug 2026 (Adam): "in the event that VOI is not
    // included in a sales agreement, we should ask for it to be uploaded in
    // the Vendor identity verified window."
    //
    // This reverses a deliberate position — the description used to end "No
    // ID copies are kept here" and hideEvidence was set for exactly that
    // reason. The reversal is narrower than it looks: what belongs here is
    // the PROOF THAT VERIFICATION HAPPENED (a VOI certificate, an e-signing
    // audit trail), not the identity documents themselves. Those are two
    // different things and the wording below has to keep them apart, because
    // the natural thing to reach for is the licence scan.
    //
    // Storing licence and passport images would put RealComply under APP 11
    // obligations it is not currently built for (see the data-residency note:
    // no MFA, free-tier backups). The warning is the control. If ID copies
    // start showing up anyway, the answer is a server-side block, not
    // stronger wording — flagged for Adam.
    // Where the agreement carried the verification (the FLK audit trail, a VOI
    // certificate bundled into the same PDF), there is nothing to attach — the
    // agreement on a3 already holds it. The control appears only when the read
    // came up empty.
    hideEvidenceWhen: (current) => aiDraft(current).identityVerified === true,
    evidenceLabel: "Verification record",
    evidenceWarning:
      "Attach the VOI certificate or e-signing audit trail. That is the proof a check was done, not the documents it was done against: licences, passports, rates notices and title searches aren't kept in RealComply, and will be refused.",
    // Adam, 20 Aug 2026: "if the AI can detect any ID documents, then it
    // rejects them." The warning above was only ever words.
    rejectIdDocuments: true,
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
    // Adam, 20 Aug 2026: "most agency agreements, all that I've seen, have a
    // box that is ticked that the vendor signs off on confirming that they
    // received a copy" — so where the agreement carries that acknowledgement,
    // the agreement IS the evidence and asking for a second copy of it is
    // exactly the re-tick this product exists to remove. The upload control
    // appears only where the read came up empty, which Adam expects to be
    // rare: "I don't think that will ever happen, though."
    hideEvidenceWhen: (current) => aiDraft(current).consumerGuideProvided === true,
    evidenceLabel: "Proof the guide was given",
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
    // MERGED FROM a4b, 22 Aug 2026 (Adam). This card used to render a generic
    // evidence slot that nothing was ever meant to go in, sitting directly
    // above a separate "Comparable-sales evidence held" card holding the
    // report. Adam: "we only need one of them." s72A is one obligation, not
    // two: record the estimate, and hold reasonable grounds for it. So the
    // report now lives on the same card as the figure it supports.
    //
    // NO findings box came across with it. a4b's findings said, in one
    // sentence, whether comparable-sales evidence was present — a fair
    // question when it was its own card, and pure restatement now that the
    // file is visibly attached to this one. Keeping it would also have meant
    // two documents writing to one item: the agency agreement patches the ESP
    // figures here, and its patch rewrites the findings text wholesale, so
    // every re-read of the agreement would have silently blanked whatever the
    // comparables report had said. Adam removed findings from this card on
    // 15 Aug for a related reason and it should not creep back.
    evidenceLabel: "Comparable sales report",
    evidenceReplaceOnly: true,
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
    // comparable-sales report, which is already attached to a4 directly
    // above — asking for a second upload on the reasoning itself invites the
    // same file twice and makes the card look incomplete when it is not
    // (Adam, 15 Aug 2026). The same reasoning is why a4 above no longer has a
    // slot of its own beyond the report: see the merge note there.
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
    // The date the contract came back from the vendor's solicitor (Adam,
    // 24 Aug 2026), so it appears on the audit record.
    //
    // It is the date the agent became ABLE to comply with s63(2) — the section
    // forbids offering the property for sale unless a copy of the contract is
    // available for inspection at the registered office. The gap between this
    // date and the first marketing is the thing a regulator would look at, and
    // until now nothing recorded the first half of it.
    requiresDate: true,
    dateLabel: "Date the contract was received",
    requiredForStageCompletion: true,
    hideNote: true,
    showFindings: true,
    evidenceReplaceOnly: true,
  },
  // ── Auction, before the day ───────────────────────────────────────────
  // Two items, both plain. Adam's steer, 18 Aug 2026: keep it to tick boxes.
  //
  // An earlier draft asked whether the auctioneer was internal or external and
  // branched the whole module off the answer. That question existed only to
  // decide who held the bidders record and what we therefore asked for — and
  // once Adam settled that the record is simply uploaded either way ("the
  // agent will either have a copy themselves or the auctioneer will give them
  // a copy after the auction, and we simply need to upload that"), the fork
  // stopped doing anything and came out.
  {
    key: "x1",
    stage: 1,
    kind: "auctioneer",
    label: "Auctioneer appointed and licensed",
    // The details are typed rather than read off the uploaded record (Adam,
    // 18 Aug 2026): "I don't know that it's necessarily going to be a
    // document, though, that we'd upload, with all auctioneer's details."
    // He's right — a bidders record is a list of bidders, and there is no
    // guarantee the auctioneer's own particulars appear on it. Since reg
    // cl 16 makes holding those particulars the SELLING licensee's own
    // obligation, they cannot depend on what happens to be printed on
    // someone else's form.
    description:
      "Who is calling the auction, and are they licensed to do it? Their details are also what you're required to hold when someone else makes the bidders record.",
    legalBasis: "ss 8, 9 Property and Stock Agents Act 2002 (NSW); reg cll 14(1), 16",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideNote: true,
    hideEvidence: true,
    showIf: isAuctionFile,
  },
  {
    key: "x2",
    stage: 1,
    kind: "checklist",
    label: "Conditions of sale prepared for display",
    description: "Attach the notice you'll have on display on the day.",
    legalBasis: "s 77 Property and Stock Agents Act 2002 (NSW); reg cll 18, 19",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideNote: true,
    showIf: isAuctionFile,
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
    // The duty runs to "any agent responsible for managing the property".
    //
    // Adam, 22 Aug 2026: "if the managing agency is also the selling agency,
    // the managing agent wouldn't need to be notified in writing, only the
    // tenant, so no need for an evidence upload there."
    //
    // He is right, and the rule's own words are why. Sch 2 r7 requires written
    // notice of the appointment to any agent responsible for managing the
    // property. Where that agent is you, there is no one to serve it on and no
    // document that could exist. The tenant notice is a different duty under a
    // different Act (s53 Residential Tenancies Act, item t2 below) and is
    // untouched by this.
    //
    // The item is answered rather than hidden. A file that simply omits t1
    // looks like an obligation nobody got to; one that records "we manage it"
    // shows the agent considered it and says why it did not apply, which is
    // the record worth having in front of Fair Trading.
    hideEvidenceWhen: (current) => selfManaged(current),
    evidenceLabel: "The written notice",
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
    // Found 22 Aug 2026 while checking every REINSW tick box against the
    // legislation. Schedule 2 rule 2 of the Regulation is blunt: an agent
    // "must not act on behalf of a vendor of a property... unless the agent
    // has conducted a preliminary physical inspection". Rule 3 then requires
    // the sales inspection report to come out of that inspection, and
    // Schedule 6 clause 8 makes the report part of the agency agreement.
    //
    // Adam, 22 Aug 2026: "it's in the name... sales inspection report and
    // exclusive selling agency agreement. So look, to cover ourselves, maybe
    // we add in the pre-marketing stage a space where the agent can enter the
    // date that the property was physically inspected."
    //
    // Stage 1 on Adam's call, though the duty bites earlier: the inspection
    // must precede acting for the vendor, which means it precedes the
    // agreement at Stage 0. Recording it later is fine, because the agent
    // enters the date it actually happened rather than the date they ticked
    // the box. What makes the placement safe is the check in setItemStatus:
    // an inspection date AFTER the agency agreement was signed means the
    // agent acted before inspecting, and the item flags rather than closes.
    key: "b6",
    stage: 1,
    kind: "checklist",
    label: "Property physically inspected before acting",
    description:
      "The date you walked through the property. The law requires a physical inspection before you act for the vendor.",
    legalBasis: "Sch 2 rr 2 & 3, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: true,
    requiredForStageCompletion: true,
    hideNote: true,
  },
  {
    key: "b3",
    stage: 1,
    kind: "checklist",
    label: "Vendor approved all marketing material",
    description:
      "Confirm the vendor has approved the marketing material (photos, copy, floorplan, signage) before it goes live.",
    legalBasis: "Sch 1 rr 8 & 9, Property and Stock Agents Regulation 2022 (NSW); Sch 2 r 3(2)(k)",
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
      "Confirm nothing from the vendor check needs escalating, or that it already has been.",
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
    legalBasis: "Supports ss 73 & 73A, Property and Stock Agents Act 2002 (NSW); s32 (duty to properly supervise)",
    licenseeOnly: true,
    requiresDate: false,
    requiredForStageCompletion: true,
    // Adam, 20 Aug 2026: "in the notes, it should be a requirement to type in
    // what the price statement is."
    //
    // He is right, and it is the difference between an attestation and a
    // record. A tick on its own asserts that the licensee approved "the price
    // statement" while preserving nothing about what that statement said — so
    // if the advertised guide is later challenged under s73/s73A, the file
    // shows an approval of an unknown figure. Writing it down makes this item
    // evidence of WHAT was approved, and pins it at the moment of approval
    // rather than leaving it to be reconstructed from whatever the ad says now.
    requiresNote: true,
    noteLabel: "The price statement being approved",
    notePlaceholder: "e.g. Guide $750,000 – $790,000",
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
    legalBasis: "s50, Property and Stock Agents Act 2002 (NSW)",
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
    legalBasis: "s49, Property and Stock Agents Act 2002 (NSW)",
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
  // ── Auction day (Stage 3) ─────────────────────────────────────────────
  // Six things, four of them a single tick. Declared in the order they
  // happen, which is also the order the property page renders them in — see
  // AUCTION_DAY_KEYS above.
  //
  // An earlier draft made this a "run-sheet" with grouped headings, nested
  // sub-checklists and explanatory panels. Adam cut it back: "I think we
  // still clearly just make a tick box." He is right, and it is the same
  // note he has given about every text-heavy screen in the product — an
  // agent standing at the kerb on a Saturday morning needs a list, not a
  // briefing.
  {
    key: "x4",
    stage: 3,
    kind: "reserve",
    label: "Reserve given to the auctioneer in writing, before the auction started",
    description:
      "It has to be in writing and it has to be before the auction commences. Attach what you gave them.",
    legalBasis: "reg cl 18(1)(a), Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x5",
    stage: 3,
    kind: "checklist",
    label: "Conditions of sale on display",
    description: "Exhibited conspicuously, in English, clear and legible, before and during the auction.",
    legalBasis: "reg cl 19, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x6",
    stage: 3,
    kind: "checklist",
    // All three named in the label rather than split into sub-ticks. Naming
    // them is what stops one being silently dropped; splitting them into
    // three boxes was the over-build Adam cut.
    label: "Required notices on display — dummy bidding, collusive practices, successful bidders",
    description: "Each in the prescribed wording. A photo of the board is the natural evidence.",
    legalBasis: "reg cl 20, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x3",
    stage: 3,
    // Moved here from On market (Adam, 18 Aug 2026), who framed it as "were
    // registered bidders given a bidders guide" — which ties it to
    // registration, and registration happens on the day.
    //
    // ⚠️ The precise statutory trigger point for s 71 could not be confirmed
    // from primary sources and is on the list for the compliance adviser. If
    // the guide has to be given earlier than registration, this item moves
    // back a stage; nothing else changes.
    kind: "checklist",
    label: "Registered bidders given the bidders guide",
    description: "The approved guide, given to each person who registered to bid.",
    legalBasis: "s 71 Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x7",
    stage: 3,
    kind: "checklist",
    label: "Bidders record",
    // Deliberately NOT required for stage completion. The auctioneer often
    // sends the record through days later, and a file that cannot close its
    // stage because of someone else's admin turns a real obligation into an
    // obstacle. It stays open and visible instead — which is what the Monday
    // digest is for.
    description:
      "Upload a copy — yours if you made it, or the auctioneer's once they send it through. It may not arrive on the day, and that's fine; this stays open until it does.",
    legalBasis: "s 68 Property and Stock Agents Act 2002 (NSW); reg cll 14, 16",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x8",
    stage: 3,
    kind: "auction",
    label: "Auction outcome",
    description:
      "What happened at the fall of the hammer. This is the one thing here that isn't a tick, and it drives the rest of the file.",
    legalBasis: "reg cl 14(1), Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: isAuctionFile,
  },
  {
    key: "x9",
    stage: 3,
    kind: "checklist",
    label: "Reserve not set aside without the vendor's permission",
    description:
      "The property didn't reach the reserve you recorded this morning. Confirm the reserve wasn't set aside without the vendor saying so.",
    legalBasis: "reg Sch 2 cl 16, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    // Only when the app can see for itself that the question arises: passed
    // in, or sold under the reserve it already holds from x4. This is the
    // kind of check worth having — the agent would otherwise be doing the
    // comparison in their head at the one moment they are busiest.
    showIf: (property, allItems) => {
      if (!isAuctionFile(property, allItems)) return false;
      const outcome = auctionOutcome(allItems);
      if (outcome.outcome === "passed_in") return true;
      const reserve = (allItems["x4"]?.data as { reserve?: number } | undefined)?.reserve;
      return Boolean(
        outcome.outcome === "sold" && reserve != null && outcome.price != null && outcome.price < reserve,
      );
    },
  },
  {
    key: "x10",
    stage: 3,
    kind: "checklist",
    label: "Telephone or absentee bidder authority held",
    description:
      "The written authority has to include an acknowledgement that the person was given a copy of the conditions of sale — that's the part that gets missed.",
    legalBasis: "reg Sch 2 cl 15; s 69(1)(b) Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    hideNote: true,
    showIf: (property, allItems) =>
      isAuctionFile(property, allItems) && Boolean(auctionOutcome(allItems).phoneBidder),
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
  // REMOVED 22 Aug 2026 (Adam): "AML COMPLETE — licensee sign-off", which sat
  // here at Sold and asked the licensee in charge to attest that the AML
  // position was properly dealt with for both parties.
  //
  // It was not a legal requirement and the card implied it was. The AML/CTF Act
  // 2006 requires the program, a named compliance officer, and the customer
  // checks themselves. It does not require a per-file sign-off by the licensee;
  // that is an agency supervision layer, and Cass covers supervision in the
  // Supervision Guidelines rather than per listing.
  //
  // Nothing about the actual AML record is lost. "Vendor check with your AML
  // provider" (Listing set-up) and "Purchaser check with your AML provider"
  // (Sold, directly above) are the items that carry the provider reference and
  // the pre-commencement position, and both stay.
  //
  // Do not re-add this on the reasoning that AML needs a human sign-off. The
  // named-human requirement attaches to the COMPLIANCE OFFICER ROLE, agency
  // wide, not to each transaction file.

  {
    // s73B: every price statement made to a buyer, prospective buyer or seller
    // "orally or in writing" must be recorded in writing, with the address,
    // the price or range, and the date and time, kept at the principal place
    // of business for 3 years. Real duty, $2,200 penalty notice.
    //
    // REBUILT 22 Aug 2026 from a log into a pointer. Adam: "I don't think we
    // should keep log quotes here. It's gonna be too tedious. It's something
    // that is kept in most agents' CRM anyway whenever they get an inquiry or
    // they do an open home check-in... we could perhaps have an option for an
    // agent to upload their own copy, but we're not gonna make it mandatory."
    //
    // He is right, and it is the product's own principle rather than a
    // concession: forms are an index to evidence, not a re-tick. A CRM logs
    // the figure at the moment of the enquiry, with the buyer attached. Asking
    // an agent to retype the same quotes here at settlement produces a worse
    // record than the one they already have, from memory, weeks late.
    //
    // NO LONGER GATES THE STAGE, and that is a deliberate trade Adam made with
    // his eyes open. The duty does not go away, so an agency that attaches
    // nothing has no evidence of s73B on the file. What it has instead is a
    // record that says where the evidence lives, which is the honest position
    // and the one a regulator can follow.
    key: "b5",
    stage: 5,
    kind: "checklist",
    label: "Record of price quotes given",
    description:
      "Every price you quote a buyer, verbally or in writing, has to be recorded with the date and time and kept for 3 years. Most CRMs already do this on enquiries and open-home check-ins. Say where yours is kept, and attach a copy if you want it in this file.",
    legalBasis: "s73B, Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
    noteLabel: "Where the record is kept",
    // Three CRMs, not one (Adam, 23 Aug 2026). The placeholder used to name
    // only LockedOn, which is what Cass runs — fine for the reference
    // implementation, wrong for the product. An agent on Box+Dice reads a
    // single competitor's name in the example box as "this was not built for
    // me", and a placeholder is the cheapest possible place to say otherwise.
    notePlaceholder: "e.g. Box+Dice, AgentBox, LockedOn",
    evidenceLabel: "Your own record (optional)",
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
    // MOVED FROM SETTLED TO CAMPAIGN, 18 Aug 2026 (Adam). Reports arrive
    // during the campaign, and cl 37 requires the register to be available to
    // anyone who asks for a copy of the contract — which is a thing that
    // happens while the property is on the market, not after it settles.
    // Sitting at Settled, the item asked for a record at the one moment it
    // could no longer be used for anything.
    //
    // Now a question first, then the work. Adam: "the box should ask a
    // question, has a building and pest report or strata report been
    // conducted? If the answer is yes, then we have to upload a copy."
    // Answering no is one press and reversible, because a report can turn up
    // at any point in a campaign.
    //
    // The upload is the expected path and the cl 37 details are read off the
    // document. Typing them is the fallback and nothing more: "I only wanna
    // have a manual entry of those details if the agent can't provide a copy
    // of the report."
    key: "f3",
    stage: 3,
    kind: "reports",
    label: "Building, pest or strata reports",
    description:
      "Has a building and pest or strata report been carried out on this property? If one has, attach it and the details the Act requires are read straight off the document. You must be able to show this register to anyone who asks for a copy of the contract for sale.",
    legalBasis: "cl 37, Property and Stock Agents Regulation 2022 (NSW)",
    requiresDate: false,
    // Required now that it asks a question. An unanswered question is not the
    // same as "no reports", and cl 37 is a register the agent has to be able
    // to produce on request.
    requiredForStageCompletion: true,
  },
  {
    key: "d3",
    stage: 3,
    kind: "reduction",
    // CORRECTED 22 Aug 2026, and the correction matters because the previous
    // reading would have sent agents chasing a step that does not exist.
    //
    // s72A(4) says the agent must revise the ESP "by (a) notifying the other
    // party to the agency agreement, in writing, of the revised estimated
    // selling price, and (b) amending the agency agreement". Read cold, that
    // looks like two documents: a notice, then a varied agreement to re-sign.
    //
    // It is one. Adam, 22 Aug 2026: "I was under the impression that if you
    // use the correct type of form to amend the ESP and provide it to the
    // vendor, there's no need to then amend and re-sign a sale agreement." He
    // is right, and the forms say so on their face. The REINSW Notice of
    // Revised Estimated Selling Price reads: "In accordance with section
    // 72A(4)(b) of the Act, this notice amends the estimated selling price in
    // the agency agreement between the Principal and the Agent dated ___",
    // and notes that "the Principal's consent is not required to amend the
    // agency agreement for the purpose of revising the estimated selling
    // price." Cass's own version carries the same operative words.
    //
    // So the notice IS the amendment. It has to be, or the section would be
    // unworkable: the ESP is the agent's opinion, not a negotiated term, and
    // requiring the vendor to counter-sign every revision would let a vendor
    // block the agent from complying with s72A(3).
    //
    // What IS a genuinely separate obligation after a revision is s73(3):
    // take all reasonable steps, as soon as practicable, to amend or retract
    // any advertisement showing a price below the revised ESP. Both forms
    // carry that as a note, and it is the second thing this item asks about.
    label: "Was the Estimated Selling Price revised?",
    description:
      "If the estimated selling price changes during the campaign, record it here. Serving the notice on the vendor is what amends the agency agreement, so there is nothing to re-sign. Keep a copy of the notice with the agreement, and get the advertising updated.",
    legalBasis: "s72A(4), s72A(5), s73(3), Property and Stock Agents Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
  {
    // The other half of cl 37, found 22 Aug 2026. The register itself is at
    // f3; cl 37(2) adds a duty most agents never notice: the licensee "must
    // disclose the records made under this section to a person requesting a
    // copy of the contract for the sale of the residential property."
    //
    // So the register is not a filing exercise. Every person who asked for a
    // contract was entitled to see it, and the way to show that happened is a
    // record of who they were.
    //
    // Adam, 22 Aug 2026: "that can be added on settlement where the agent can
    // either upload a copy of the record that they have of everyone they've
    // sent a contract to. Most CRMs do this, or they can just enter the names
    // of the buyers manually."
    //
    // Hence requiresNote AND an upload, either of which satisfies it. See the
    // note-or-evidence carve-out in setItemStatus: typing the names is enough,
    // and so is attaching the CRM export, but a bare tick is not.
    key: "f4",
    stage: 5,
    // One line per buyer, added one at a time (Adam, 23 Aug 2026): "let's have
    // an ADD BUYER button and each buyer gets their own line and field."
    //
    // A single free-text box was the wrong shape for a list. Names typed into
    // one field come back as a blob nobody can count, and the thing cl 37(2)
    // asks you to show is WHO — which is a list, and should be stored as one.
    //
    // Stays a "checklist" kind. The list renders inside ChecklistItem above its
    // form rather than as a separate kind, so the note box, the CRM upload and
    // Mark done all keep behaving exactly as they do on every other card. Its
    // own add form sits outside that form, because forms cannot nest.
    kind: "checklist",
    label: "Buyers who received a copy of the Contract for Sale",
    description:
      "Buyers who request a copy of the contract are entitled to see the building, pest and strata report register. Add each buyer, or point at the record your CRM already keeps.",
    // "Supports", not a bare citation, and the distinction is the honest one.
    //
    // Checked against the Regulation on 25 Aug 2026 when Adam asked what the
    // legal basis for this list actually is. NOTHING in the Act or the
    // Regulation requires an agent to keep a register of who received a copy
    // of the contract. What cl 37 requires is a record of the BUILDING, PEST
    // AND STRATA REPORTS the licensee is aware of; cl 37(2) then requires that
    // record to be disclosed "to a person requesting a copy of the contract for
    // the sale of the residential property".
    //
    // So the duty is triggered by a person asking for a contract, and this list
    // is how an agency evidences that it met the duty each time it was
    // triggered — you cannot show you disclosed to everyone who asked without
    // knowing who asked. That makes it a control, not an obligation, and the
    // wording has to say so.
    //
    // s63 sits behind it too: the proposed contract and its s52A documents must
    // be available for inspection at all times an offer may be made. Serving
    // the contract after exchange is a different duty again and has its own
    // card (Sch 2 r17).
    legalBasis:
      "Supports cl 37(2), Property and Stock Agents Regulation 2022 (NSW) — the property-reports record must be disclosed to anyone requesting a copy of the contract; s63 PSA Act 2002 (NSW)",
    requiresDate: false,
    requiredForStageCompletion: true,
    requiresNote: true,
    noteLabel: "Where the record is kept",
    // Deliberately identical to the price-quotes card (Adam, 23 Aug 2026).
    // Both ask the same question — which system holds this — so they should
    // ask it in the same words.
    notePlaceholder: "e.g. Box+Dice, AgentBox, LockedOn",
    evidenceLabel: "CRM record (instead of typing names)",
  },
  {
    // REMOVED 23 Aug 2026 (Adam): "Compliance file signed off by the
    // licensee", a licensee-only tick box that sat here asking the licensee to
    // confirm they had reviewed the file.
    //
    // It asked for the same thing twice. "Licensee signature" below is the
    // licensee typing their name to adopt it as their signature on this file,
    // which is a stronger record of the same act — a tick beside it added
    // nothing except another thing to chase.
    //
    // Adam: "agent shouldn't be able to close out the listing until it's been
    // done." So the signature now GATES the close-out rather than a checkbox
    // asserting it happened. See generateExport in lib/actions/compliance.ts,
    // which refuses to produce the finalised file until sign_licensee is done,
    // and the ExportItem card, which says what it is waiting for.
    //
    // That is the better shape: the box could be ticked without the signature
    // existing, which is precisely the wrong way round for the document that
    // gets handed to Fair Trading.
    key: "sign_agent",
    stage: 5,
    kind: "sign",
    label: "Agent signature",
    description: "Type your name to adopt it as your signature on this file.",
    legalBasis: "Supports s104, Property and Stock Agents Act 2002 (NSW) — records a licensee must make and keep",
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
    legalBasis: "Supports s32, Property and Stock Agents Act 2002 (NSW) — duty to properly supervise the business",
    requiresDate: false,
    requiredForStageCompletion: true,
    hideEvidence: true,
    // Not shown where the agent IS the licensee. Adam, 23 Aug 2026: "if the
    // agent running a listing is also the licensee, then we don't need to have
    // the send to licensee card." Sending a file to yourself is a step that
    // records nothing.
    showIf: (_p, _items, ctx) => ctx?.agentIsLicensee !== true,
  },
  {
    key: "sign_licensee",
    stage: 5,
    kind: "sign",
    label: "Licensee signature",
    description: "The licensee in charge types their name to adopt it as their signature.",
    legalBasis: "Supports s32, Property and Stock Agents Act 2002 (NSW) — duty to properly supervise the business",
    licenseeOnly: true,
    hideEvidence: true,
    requiresDate: false,
    requiredForStageCompletion: true,
    // Only where the agent IS the licensee, so they sign it here directly.
    // Where the licensee is someone else the signature arrives through the
    // sign-off link instead, and showing the card to an agent who cannot
    // action it is showing them somebody else's job (Adam, 23 Aug 2026).
    //
    // NOTE: the signature is still what gates closing out either way — see
    // generateExport. This governs where it is given, not whether it is needed.
    showIf: (_p, _items, ctx) => ctx?.agentIsLicensee === true,
  },
  {
    key: "f2",
    stage: 5,
    kind: "export",
    label: "Generate finalised compliance file",
    description:
      "Generates the finalised, read-only compliance record for this file. (A polished branded PDF export is a follow-up — this produces a printable summary today.)",
    legalBasis: "Supports s104, Property and Stock Agents Act 2002 (NSW) — records a licensee must make and keep",
    requiresDate: false,
    requiredForStageCompletion: false,
  },
];

// Server components pass ComplianceItem objects straight into client
// components (ItemCard). `showIf` and `hideEvidenceWhen` are functions, and
// functions can't cross the server/client boundary — resolve both here, once
// filtering is decided, so callers always get a plain, serializable object.
//
// A stray function reaching a client component doesn't warn, it throws — an
// "error occurred in the Server Components render" (Minified React error
// #441) that takes the whole page down. That's exactly what every Stage 0
// listing did on open: a1 and a2 both carry a hideEvidenceWhen predicate,
// and stripShowIf (as it was) only ever stripped showIf, leaving
// hideEvidenceWhen on the object handed to <ItemCard>. Every other stage was
// fine because no item outside Stage 0 defines one.
//
// hideEvidenceWhen(current) folds into the static hideEvidence flag rather
// than surviving as a function — but only when there's nothing already
// attached, per the "never strand a file" rule in ItemShell (see
// components/compliance/ItemCard.tsx): an attached evidence_path always
// keeps the upload control visible, however the predicate reads.
function resolveItem(item: ComplianceItem, current?: PropertyItem): ComplianceItem {
  const { showIf: _showIf, hideEvidenceWhen, ...rest } = item;
  const dynamicHide = Boolean(hideEvidenceWhen?.(current)) && !current?.evidence_path;
  return { ...rest, hideEvidence: Boolean(rest.hideEvidence) || dynamicHide };
}

export function itemsForStage(
  stage: PropertyStage,
  property: Property,
  allItems: Record<string, PropertyItem> = {},
  ctx: RuleContext = {},
): ComplianceItem[] {
  return items
    .filter((item) => item.stage === stage)
    .filter((item) => (item.showIf ? item.showIf(property, allItems, ctx) : true))
    .map((item) => resolveItem(item, allItems[item.key]));
}

export function allItemsFor(
  property: Property,
  allItems: Record<string, PropertyItem> = {},
  ctx: RuleContext = {},
): ComplianceItem[] {
  return items
    .filter((item) => (item.showIf ? item.showIf(property, allItems, ctx) : true))
    .map((item) => resolveItem(item, allItems[item.key]));
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
  // No property/allItems context here — there's no `current` to evaluate
  // hideEvidenceWhen against, and this list never reaches a client
  // component (see the doc comment above), so resolveItem's stripping is
  // enough without trying to resolve the dynamic half.
  return items.map((item) => resolveItem(item, undefined));
}

export function getItem(key: string): ComplianceItem | undefined {
  return items.find((item) => item.key === key);
}
