import type Anthropic from "@anthropic-ai/sdk";
import { FileCantBeRead, TooLargeToRead, askParts, prepareRead, type PartQuestion } from "@/lib/documents/read-core";
import { isPartOnlyNote, mergeReads } from "@/lib/documents/reader-parts";
import { PRESCRIBED_DOC_KEYS, type PrescribedDoc } from "@/lib/rules/nsw-prescribed-documents";

// The listing documents' reader: the agency agreement, the contract for sale
// and the comparable-sales report. Moved here from lib/actions/extraction.ts
// on 1 Nov 2026, word for word, so the sample comparable-sales reports
// (lib/documents/sample-cmas) can be read through exactly the code the app
// uses, by the tests on every pull request and by the daily check on live.
// lib/actions/extraction.ts downloads the file from its card and writes what
// comes back; nothing here touches the database.

// The three setup-time documents (property creation form) and which item
// each is attached to as evidence — see src/lib/actions/properties.ts.
// a4 (not a4b) holds the comparable-sales report as of 22 Aug 2026 — the two
// ESP cards were merged into one, so the report now sits on the same card as
// the figure it supports. See the merge note on a4 in rules/nsw-sales.ts.
export const SOURCE_ITEM_KEYS = ["a3", "b1", "a4"] as const;
export type SourceKey = (typeof SOURCE_ITEM_KEYS)[number];

export const SOURCE_LABELS: Record<string, string> = {
  a3: "agency agreement",
  b1: "contract for sale",
  a4: "comparable-sales report",
};

// ── Which document may speak to which item ─────────────────────────────────
//
// ADDED 20 Aug 2026, after a real file (24/1 Citrus Ave) came back with the
// contract's cooling-off statement recorded against a6 and all nine s52A
// prescribed documents ticked off an agency agreement. Adam: "it's confusing
// contract for sale with sale agreement."
//
// The cause was not the model misreading either document. It was that all
// three uploads received the SAME prompt — every compliance item plus the
// contract check — and every patch that came back was pooled into one array
// with no record of which file produced it. Nothing stopped the contract from
// answering agency-agreement questions, because nothing ever asked whether it
// should be allowed to.
//
// So the binding is enforced HERE, in code, after the model returns. A prompt
// is an instruction; this is a rule. a5 (commission) and a6 (agency-agreement
// cooling-off) exist only in the agency agreement — a contract for sale
// carries a cooling-off statement too, but it is the purchaser's five-day
// right under s66X of the Conveyancing Act, a different period under a
// different Act, and recording it here would put the wrong law on the card.
export const SOURCE_TARGETS: Record<SourceKey, ReadonlySet<string>> = {
  a3: new Set(["a1", "a2", "a3", "a4", "a4c", "a5", "a6", "a7"]),
  b1: new Set(["b1"]),
  // The comparables report is ATTACHED to a4 but may not write to it.
  //
  // The ESP itself belongs in the agency agreement (s72A); a comparables
  // report may suggest a range but that is not the figure the agent agreed,
  // and a provider's automated estimate landing in the ESP boxes is the exact
  // failure Adam caught on 15 Aug. Since the merge put both documents on the
  // same item, that separation has to be stated here rather than assumed:
  // a3 writes the figures, this writes nothing but the reasoning draft.
  a4: new Set(["a4c"]),
};

// What the document turned out to be, as opposed to which box it was uploaded
// into. The model answers this first, on every read.
export type DocumentKind = "agency_agreement" | "contract_for_sale" | "comparable_sales" | "other";

export const EXPECTED_KIND: Record<SourceKey, DocumentKind> = {
  a3: "agency_agreement",
  b1: "contract_for_sale",
  a4: "comparable_sales",
};

export const KIND_LABELS: Record<DocumentKind, string> = {
  agency_agreement: "an agency agreement",
  contract_for_sale: "a contract for sale of land",
  comparable_sales: "a comparable-sales report",
  other: "a different kind of document",
};

// Only these items can ever be patched by extraction — a hard allow-list,
// independent of whatever the model returns. Deliberately excludes every
// licenseeOnly item (f1, sign_licensee) and every log-style item
// (d1/d2/d3, offers, reviews) — those have their own entry semantics and
// AI must never touch a licensee sign-off, full stop.
//
// a1 (vendor identity) IS included. This comment used to say the opposite,
// on the grounds that identity "is verified externally as part of AML/CTF CDD
// and registered with AUSTRAC there" — both halves of which are wrong, and
// Adam caught the same claim in nsw-sales.ts on 17 Aug 2026: AUSTRAC receives
// suspicious matter and threshold transaction reports, never routine CDD
// outcomes, and CDD establishes who your CUSTOMER is, not who owns the land.
// The comment survived the correction because nothing tests a comment. a1 has
// been in the list below since 17 Aug.
//
// a2 (consumer guide given before signing) IS included — see
// the consumerGuideProvided field below and the autoComplete logic in
// extractFromDocuments for why it's handled differently from every other
// item here.
export const TARGET_ITEM_KEYS = new Set(["a1", "a2", "a3", "a4", "a4c", "a5", "a6", "a7", "b1"]);

// One verdict per prescribed document, for item b1. "found" and "not_found"
// are both real answers; there is no "unclear" because a document the model
// cannot positively identify has, for the agent's purposes, not been found —
// and the wording shown to them says exactly that rather than claiming the
// contract is deficient.
export type PrescribedDocVerdict = {
  key: string;
  found: boolean;
};

export type DraftPatch = {
  itemKey: string;
  note?: string;
  espLow?: number;
  espHigh?: number;
  /**
   * a4 only. The date the written ESP and the evidence of its reasonableness
   * were given to the vendor, where the document states it (s72A(2), from
   * 17 Nov 2026). Offered on the ESP card; never saved for the agent.
   */
  espGivenOn?: string;
  /** a3 only. The private-treaty offering price, verbatim from the agreement. */
  offerPrice?: string;
  eventDate?: string;
  consumerGuideProvided?: boolean;
  identityVerified?: boolean;
  /**
   * a7 only — whether the agreement records that the vendor disclosed a
   * material fact. Three states, and the third one matters: true (a fact was
   * disclosed), false (the vendor was asked and answered none), and ABSENT
   * (the document doesn't settle it). Absent must stay absent — Adam, 19 Aug
   * 2026: "if it's not in there, then leave it as a manual action."
   *
   * Never auto-completes the item. See the a7 note in runExtraction.
   */
  materialFactDisclosed?: boolean;
  prescribedDocs?: PrescribedDocVerdict[];
  /**
   * b1 only. The council that issued the planning certificate in the
   * contract, as the certificate names it ("Hornsby Shire Council"). The app
   * matches it to a NSW council area for metro or non-metro (Reg s12A; 0118)
   * and asks the agent when it can't. Applied to the PROPERTY row, never a card.
   */
  councilArea?: string;
  /**
   * Set on a b1 patch when the uploaded file is not a contract for sale at
   * all, so the card can say so plainly instead of showing a document
   * checklist run against the wrong document.
   *
   * Superseded by wrongDocument below, which covers all three slots rather
   * than just this one. Kept so cards drafted before 20 Aug 2026 still read
   * correctly.
   */
  notAContract?: boolean;
  /**
   * The uploaded file is not the kind of document this slot expects. Set by
   * runExtraction, never by the model — the model reports what the document
   * IS and this code decides whether that matches.
   *
   * When set, it is the ONLY thing recorded from that document. Reading an
   * agency agreement for contract facts produces answers that look perfectly
   * plausible and are wrong, which is worse on a compliance file than no
   * answer at all.
   */
  wrongDocument?: { expected: string; actual: string };
  /**
   * a3 only — the method of sale, and the auction date and time where the
   * agreement states them. Adam, 18 Aug 2026: "method of sale, auction date
   * and time will be in the sales agreement as well." So the agent should not
   * be typing them in twice. Applied to the PROPERTY row rather than an item,
   * and only where the agent has not already answered — see runExtraction.
   */
  saleMethod?: "private_treaty" | "auction";
  auctionDate?: string;
  auctionTime?: string;
  /**
   * a4c only, and only from the comparable-sales report — scrubbed off every
   * other source in extractOneDocument.
   *
   * The sales the report lists, as rows. This is the factual half of the ESP
   * justification and the half a model should do: transcription and
   * arithmetic off a document the agent already has. The judgement half —
   * which of these mattered and why — is the agent's and is never touched
   * here. See RealComply-comparable-sales-AI-notes-design.md.
   */
  comparableSales?: ComparableSaleRead[];
  /**
   * a4c only, from the comparables report. The SUBJECT property's own
   * attributes, which these reports almost always state on their first page.
   * Held as suggestions on the property row and shown for confirmation; they
   * never become the confirmed values without a person accepting them.
   */
  subjectProperty?: SubjectAttributesRead;
  /**
   * a4c only, from the comparables report. Properties the report lists as
   * currently FOR SALE (29 Sep 2026, Stephen Borg's point that the ESP
   * reasoning should consider the competition). Facts only; the agent marks
   * which are direct competition. Written to property_market_listings.
   */
  marketListings?: MarketListingRead[];
};

export type MarketListingRead = {
  address: string;
  askingPrice?: string;
  saleMethod?: string;
  listedDate?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSizeSqm?: number;
  internalAreaSqm?: number;
  distanceM?: number;
  propertyType?: string;
};

export type ComparableSaleRead = {
  address: string;
  salePrice?: number;
  saleDate?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSizeSqm?: number;
  internalAreaSqm?: number;
  distanceM?: number;
  propertyType?: string;
};

export type SubjectAttributesRead = {
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSizeSqm?: number;
  internalAreaSqm?: number;
};

// BEDS, BATHS AND CARS, 0 INCLUDED (Adam, 11 Nov 2026: "read and record
// number of bed, bath and car. still allow even if those data points read
// 0"). A 0 is an answer: a studio has 0 bedrooms, a unit with no parking 0
// car spaces. Left out, it reads as "not known", and the agent is asked to
// fill in a figure the document gave. The app already keeps a 0 from here
// to the comparables table and the statement of information.
const COUNT_ZERO_TOO =
  " A whole number, as printed. Record 0 when the document shows 0, 'nil' or 'none': 0 is a real answer, never leave it out. Leave it out only when the document doesn't give it (blank, a dash, or not shown).";
const countField = (what: string) => ({ type: "number", description: `Number of ${what}.${COUNT_ZERO_TOO}` });

export const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_findings",
  description:
    "Flag anything the agent needs to see for each compliance item — a gap, an ambiguity, something missing, something needing their confirmation. Do not restate facts the document already states plainly; the agent has the document, so repeating it back adds nothing. Only call this with things actually grounded in the document — never a guess or an inference.",
  input_schema: {
    type: "object",
    properties: {
      documentIs: {
        type: "string",
        enum: ["agency_agreement", "contract_for_sale", "comparable_sales", "other"],
        description:
          "ALWAYS set this, and decide it before anything else. What kind of document have you actually been " +
          "shown? Judge it from what the document IS — its heading, its parties, its structure — not from what " +
          "it lacks and not from the filename. " +
          "'agency_agreement' — a Sales Inspection Report and Selling Agency Agreement, or any agreement " +
          "appointing the agency to sell: it names the licensee and the vendor, sets commission, and carries " +
          "the vendor's declarations. " +
          "'contract_for_sale' — a contract for the sale of land: headed as such, names the vendor and the " +
          "vendor's solicitor or conveyancer, carries the s66X cooling-off statement, and usually has a List " +
          "of Documents page followed by annexures. CRITICAL: a contract prepared for a new listing has NO " +
          "purchaser named, NO agreed price and NO settlement date, because it must exist before the property " +
          "is offered for sale. Those absences are normal and must NEVER lead you to call it something else. " +
          // Judged by what it holds, not how it looks (Adam, 11 Nov 2026):
          // what makes comparable sales is the properties, each with an
          // address and a price, and their beds, baths, cars and land.
          "'comparable_sales' — judge this one by its CONTENTS, not its heading or layout: a document that " +
          "lists other properties, each with an address and a price (sold, or advertised for sale), usually " +
          "with beds, baths, car spaces, land size or a sale date. Any format counts: a provider's report " +
          "(Cotality, PropTrack, Pricefinder or similar), an agent's own appraisal or comparative market " +
          "analysis, a letter or proposal to the vendor, a table or a list, or a few pages taken from any of " +
          "these. " +
          "'other' — anything else. " +
          "These two are genuinely easy to confuse and the consequences of getting it wrong are real, so look " +
          "at the heading and the parties before you answer.",
      },
      patches: {
        type: "array",
        description: "Zero or more findings. Return an empty array if there's nothing to flag and no structured figures/dates to record.",
        items: {
          type: "object",
          properties: {
            itemKey: {
              type: "string",
              enum: Array.from(TARGET_ITEM_KEYS),
              description: "Which compliance item this fact supports.",
            },
            note: {
              type: "string",
              description:
                "Only something the agent needs to act on or confirm — a gap, an inconsistency, a missing detail. Never a restatement of a fact the document already states clearly (e.g. do not write 'commission is 2.2%, as stated in clause 4' — that tells the agent nothing they don't already have in front of them). Leave this out entirely, or send an empty string, when the document covers the item completely with nothing exceptional to flag. Exception: for a4c specifically, this field instead carries the agent's own ESP reasoning if the document contains it, copied in the document's own words (not paraphrased or summarised), for the agent to confirm — not a gap-flag.",
            },
            espLow: {
              type: "number",
              description: "Item a4 only — low end of an estimated selling price, only if the document explicitly states a figure.",
            },
            espHigh: {
              type: "number",
              description: "Item a4 only — high end, only if explicitly stated.",
            },
            espGivenOn: {
              type: "string",
              description:
                "Item a4 only. The date the vendor was given the written estimated selling price and the evidence that it is reasonable (comparable sales), before the agency agreement was signed. Set it ONLY where the document explicitly states that date, for example a vendor's signed and dated acknowledgement of receiving the ESP and the comparable sales, or a dated ESP notice addressed to the vendor. Never use the agreement's signing date, the report's preparation date or any other date in its place. Format YYYY-MM-DD. Omit it otherwise.",
            },
            offerPrice: {
              type: "string",
              description:
                "Item a3 only, and only for a PRIVATE TREATY agreement. Schedule 6, section 5 of the Property and Stock Agents Regulation 2022 requires an agency agreement for the sale of residential property by private treaty to specify the price at which the property is to be offered, usually under a heading like 'Price at which the property is to be offered'. Copy that figure or range EXACTLY as the agreement states it, including the dollar signs and any wording such as 'Offers above'. Do not convert a range into a single figure, do not round, and do not substitute the estimated selling price, which is a different field with a different legal meaning. An auction agreement has no such term: omit this field entirely rather than supplying the reserve, a guide, or the ESP in its place.",
            },
            eventDate: {
              type: "string",
              description: "Only for a date the document explicitly states (e.g. the agreement's signing date). Format YYYY-MM-DD.",
            },
            consumerGuideProvided: {
              type: "boolean",
              description:
                "Item a2 only — true only if the document explicitly confirms the approved consumer guide (the approved guide required by s56 of the Property and Stock Agents Act) was given to the vendor before the agency agreement was signed — e.g. an acknowledgement clause, a signed receipt, a ticked box referencing the guide. Do not set this from the agreement's mere existence or from silence on the point. If the document doesn't explicitly address it, omit this field and leave a2 out of the patches entirely rather than guessing. When you do set this true, also set that a2 patch's eventDate to the date the guide was given, only if that specific date is stated — if provision is confirmed but no date is given, omit eventDate and use note instead to flag it for the agent so they can supply the date manually.",
            },
            identityVerified: {
              type: "boolean",
              description:
                "Item a1 only — true only if the document explicitly confirms the vendor's identity was verified. Two forms count equally. (1) A statement in the agreement itself, among the vendor declarations or near the signing block: a confirmation that identity documents were sighted, a completed proof-of-identity or verification-of-identity section, a reference to VOI having been completed, or a ticked box. (2) A separate identity record BUNDLED INTO THE SAME PDF — an e-signing completion certificate or audit trail (FLK, DocuSign, Adobe Sign), an Identity Verification Report or VOI certificate (IDVerse, Digital iD, ZipID, InfoTrack), or a page listing each signer with the identity check performed and its timestamp. Form (2) is the common one for electronically signed agreements and counts fully — do not discount it for sitting outside the agreement's own pages. Set this true ONLY on an explicit confirmation actually present in what you were shown. Never infer it from the agreement merely existing, from the vendor having signed, from the vendor's name appearing, or from identity verification being good practice. If neither form is present, omit this field and leave a1 out of the patches entirely — that absence is normal and is NOT a finding. When you set this true, also set that a1 patch's eventDate (YYYY-MM-DD) to the date verification was carried out, taken from the VOI report's date or the audit trail's identity-check timestamp; where signers were verified on different dates use the last. Do not substitute the agreement's signing date for a verification date you cannot see.",
            },
            prescribedDocs: {
              type: "array",
              description:
                "Item b1 only, and only when the document really is a contract for sale of land. One entry for each prescribed document named in the instructions for this property — every one of them, whether or not you found it. This is a positive check: the agent wants to see which are present as much as which are missing.",
              items: {
                type: "object",
                properties: {
                  key: { type: "string", enum: PRESCRIBED_DOC_KEYS },
                  found: {
                    type: "boolean",
                    description:
                      "True only if you can actually see that document in what you were shown. An entry in a 'List of Documents' index page is not the document itself — do not mark found on the strength of the index alone.",
                  },
                },
                required: ["key", "found"],
              },
            },
            councilArea: {
              type: "string",
              description:
                "Item b1 only, and only when the document really is a contract for sale of land. The name of the council that issued the PLANNING CERTIFICATE attached to the contract (the certificate under section 10.7 of the Environmental Planning and Assessment Act 1979), exactly as the certificate names that council, for example 'Hornsby Shire Council' or 'City of Parramatta Council'. The council's name only: no address, ABN, certificate number or department. Take it from the planning certificate itself, normally its heading or letterhead. Never from the property's address or suburb, the vendor's or solicitor's address, a rates notice, a sewer diagram or the List of Documents. Omit it if no planning certificate is attached or it does not name the council.",
            },
            materialFactDisclosed: {
              type: "boolean",
              description:
                "Item a7 only. Whether the vendor disclosed a material fact. A NSW selling agency agreement normally carries a vendor disclosure section covering the prescribed material facts — flood or bushfire history, loose-fill asbestos, prior known defects and so on. Set TRUE only where the document records that the vendor actually disclosed something. Set FALSE only where the section IS present and completed and records that there is nothing to disclose (a completed 'none' / 'nil' / all boxes answered no). If the section is absent, blank, partly completed, or you cannot tell whether the vendor was asked at all, OMIT this field entirely — do not guess, and above all do not read silence as 'none disclosed'. An unanswered question and a vendor saying no are completely different things, and only the second one is a record. Where you set this true, use note to say in one short sentence what was disclosed.",
            },
            saleMethod: {
              type: "string",
              enum: ["private_treaty", "auction"],
              description:
                "Item a3 only (the agency agreement). How the property is to be sold, ONLY if the agreement states it — a NSW selling agency agreement normally names the method of sale explicitly, often as a tick box or a named 'Auction' section. Set 'auction' only on an explicit statement that the property is to be offered at auction. Do not infer auction from the presence of an auction-related clause that is part of the printed form regardless. If the agreement does not state the method, omit this field entirely.",
            },
            auctionDate: {
              type: "string",
              description:
                "Item a3 only, and only when saleMethod is 'auction'. The auction date, format YYYY-MM-DD, ONLY if the agreement states a specific date. Very often it is blank or reads 'TBC' at the time the agreement is signed — that is completely normal, and in that case omit this field rather than guessing or inferring one from the agreement date or the campaign length.",
            },
            auctionTime: {
              type: "string",
              description:
                "Item a3 only, and only when saleMethod is 'auction'. The auction time exactly as the agreement writes it (e.g. '10:00am', '11am'). Omit if not stated.",
            },
            notAContract: {
              type: "boolean",
              description:
                "Item b1 only. Set true if the file uploaded as the contract for sale is plainly a different kind of document (most commonly the agency agreement). When true, omit prescribedDocs entirely and put one short sentence in note naming what the document actually is.",
            },
            comparableSales: {
              type: "array",
              description:
                "Item a4c only, and ONLY when reading a comparable-sales report. One entry for every sold property the report lists — all of them, in the order the report presents them. Record only what is printed: leave a field out rather than estimating, converting or inferring it. Do NOT include the subject property itself, do NOT include properties listed as currently for sale or under offer rather than sold, and do NOT rank, score or judge them — which sales matter is the agent's decision and recording an opinion here would put words in their mouth on the one figure they may be asked to substantiate under s74.",
              items: {
                type: "object",
                properties: {
                  address: {
                    type: "string",
                    description: "Street address as the report prints it, e.g. '14 Smith St, Mount Colah'. Required.",
                  },
                  salePrice: { type: "number", description: "Sale price in dollars, digits only. Omit if the report withholds it." },
                  saleDate: { type: "string", description: "Date of sale, YYYY-MM-DD. Omit unless a specific date is printed — a month alone is not a date." },
                  bedrooms: countField("bedrooms"),
                  bathrooms: countField("bathrooms"),
                  carSpaces: countField("car spaces (garage, carport or parking spaces)"),
                  landSizeSqm: { type: "number", description: "Land size in square metres. Convert hectares only where the report itself gives both; otherwise omit." },
                  internalAreaSqm: { type: "number", description: "Internal or building area in square metres, if stated separately from land." },
                  distanceM: { type: "number", description: "Distance from the subject property in METRES, only if the report states a distance. Convert a printed kilometre figure to metres; do not calculate one from addresses." },
                  propertyType: { type: "string", description: "e.g. house, townhouse, unit — only as the report describes it." },
                },
                required: ["address"],
              },
            },
            marketListings: {
              type: "array",
              description:
                "Item a4c only, and ONLY when reading a comparable-sales report. One entry for every property the report lists as CURRENTLY FOR SALE (on the market, listed, for sale, active listing) — not sold properties, which go in comparableSales, and not the subject property itself. In the report's own order. Record only what is printed. The advertised price is another agent's asking price or guide, copied exactly as printed (it may be a range, 'Contact agent', 'Auction', 'Offers over $X'); never convert it into a single number and never call it a sale price. Do NOT rank, score or judge them — which listings are real competition is the agent's decision.",
              items: {
                type: "object",
                properties: {
                  address: { type: "string", description: "Street address as the report prints it. Required." },
                  askingPrice: { type: "string", description: "The advertised price or guide exactly as printed, e.g. '$1,200,000 - $1,300,000', 'Contact Agent'. Omit if none is shown." },
                  saleMethod: { type: "string", description: "e.g. 'Auction', 'Private treaty', 'Expressions of interest', only as printed." },
                  listedDate: { type: "string", description: "Date first listed, YYYY-MM-DD, only if a specific date is printed. Do not calculate it from a days-on-market figure." },
                  bedrooms: countField("bedrooms"),
                  bathrooms: countField("bathrooms"),
                  carSpaces: countField("car spaces (garage, carport or parking spaces)"),
                  landSizeSqm: { type: "number", description: "Land size in square metres, only as printed." },
                  internalAreaSqm: { type: "number" },
                  distanceM: { type: "number", description: "Distance from the subject in METRES, only if printed. Convert a printed km figure; do not calculate one." },
                  propertyType: { type: "string" },
                },
                required: ["address"],
              },
            },
            subjectProperty: {
              type: "object",
              description:
                "Item a4c only, and ONLY from a comparable-sales report. The attributes of the SUBJECT property — the one the report was prepared for, usually named on its first page — not of any comparable. Everything optional; omit anything not printed. These are shown to the agent for confirmation, never used as fact until they accept them.",
              properties: {
                bedrooms: countField("bedrooms"),
                bathrooms: countField("bathrooms"),
                carSpaces: countField("car spaces (garage, carport or parking spaces)"),
                landSizeSqm: { type: "number" },
                internalAreaSqm: { type: "number" },
              },
            },
          },
          required: ["itemKey"],
        },
      },
    },
    required: ["documentIs", "patches"],
  },
};

// The b1 half of the extraction prompt, built per property because the
// applicable list depends on whether the listing is strata.
//
// REWRITTEN 15 Aug 2026 (Adam) after the previous version produced a finding
// that was wrong twice over on a real file. It had said the document was not a
// contract because it contained "no purchaser details, price agreed for sale,
// or settlement terms" — but a contract for sale at listing stage has none of
// those by definition, since s52A requires it to exist BEFORE a buyer or a
// price does. That test would reject every compliant contract it ever saw. It
// then reported that the s52A check "does not apply to this document and was
// not performed", which is narration of work not done and of no use to anyone.
export function prescribedDocsPrompt(docs: PrescribedDoc[]): string {
  const list = docs
    .map((d) => `    - ${d.key} — ${d.label} (${d.source}). Looks like: ${d.hint}`)
    .join("\n");

  return (
    "b1 (the contract for sale and its s52A prescribed documents).\n" +
    "  You have already answered documentIs. If it was anything other than 'contract_for_sale', return an " +
    "EMPTY patches array and stop — do not run the check below, do not list what you could not check, and do " +
    "not explain that s52A does not apply. The agent will be told which document they actually uploaded.\n" +
    "  If it IS a contract, check for each of these prescribed documents and return a prescribedDocs " +
    "entry for EVERY one, found true or false:\n" +
    list +
    "\n  Look through the whole document, including the annexures after the contract's own pages. Judge found " +
    "on seeing the actual document, not on its name appearing in a List of Documents index. Do not write a " +
    "note describing which ones you found or did not find — the prescribedDocs array carries all of that and " +
    "the agent is shown it as a list. Leave note empty unless there is something genuinely odd that the " +
    "found/not-found answers cannot express, such as a certificate that is visibly for a different property.\n" +
    "  ALSO on the b1 patch: where a planning certificate is attached, set councilArea to the name of the " +
    "council that issued it, exactly as the certificate names that council. It decides which comparable sales " +
    "the agent must consider (metropolitan or not), so take it only from the planning certificate itself and " +
    "omit it if there is none. Write no note about it."
  );
}

// ── One prompt per document ────────────────────────────────────────────────
//
// Until 20 Aug 2026 all three uploads got the same prompt: every item plus the
// contract check. That is what let the contract answer for the agency
// agreement and back again. Worse, sending the "is this a contract? here is
// what people mistake for one" block alongside a read of the agency agreement
// primes exactly the confusion it is warning about.
//
// Each document is now asked only what it can answer. The allow-list in
// SOURCE_TARGETS is still the thing that enforces it — this just stops us
// inviting the wrong answer in the first place, and costs fewer tokens.

export const AGENCY_AGREEMENT_PROMPT =
  "a1 (whether the vendor's identity was verified. LOOK IN TWO PLACES, and the second is the one " +
  "that is usually there. FIRST, the vendor declarations and signing pages: a proof-of-identity or " +
  "verification-of-identity section, a statement that identity documents were sighted, a reference " +
  "to VOI being completed, or a ticked box to that effect. SECOND — and check this even when the " +
  "first turns up nothing — a separate identity document BUNDLED INTO THIS SAME PDF, after or " +
  "before the agreement's own pages. Agreements signed electronically routinely carry one: an " +
  "e-signing completion certificate or AUDIT TRAIL (FLK, DocuSign, Adobe Sign and the like), an " +
  "Identity Verification Report or VOI certificate (IDVerse, Digital iD, ZipID, InfoTrack and the " +
  "like), or a page recording each signer with the identity check performed on them and when. A " +
  "file named with something like 'with-audit-trail' is a strong hint one is present, but read for " +
  "it either way. Those pages ARE the verification record — treat them exactly as you would a " +
  "declaration in the body of the agreement. Set identityVerified true on an explicit confirmation " +
  "from EITHER place, and set eventDate to the date verification was carried out: the date on the " +
  "VOI report, or the identity-check timestamp in the audit trail. Where the audit trail gives a " +
  "date per signer and they differ, use the LAST one, since that is when the last vendor was " +
  "verified. Give the date only as YYYY-MM-DD, and only from a date actually printed there — never " +
  "assume it matches the agreement's signing date. IMPORTANT: if neither place shows anything, " +
  "that is entirely normal — verification is often recorded in a system outside this document — so " +
  "leave a1 out of the patches entirely and write no note about it. Do not report its absence as a " +
  "gap, a risk, or anything at all. That instruction is about SILENCE when there is nothing to " +
  "find; it is not a reason to skip looking, and it does not apply once you have found something), " +
  "a2 (whether the " +
  "approved consumer guide was given to the vendor before the agency agreement was signed. LOOK FOR " +
  "THIS DELIBERATELY — in a NSW residential agency agreement it is normally a short acknowledgement " +
  "by the vendor, near the signing block or among the vendor declarations, worded along the lines of " +
  "acknowledging receipt of the approved guide, the consumer guide, or the approved consumer guide " +
  "for agency agreements, sometimes as a tick-box and sometimes with its own date beside it. It is " +
  "easy to skim past because it sits among boilerplate, so read the declarations and signing pages " +
  "specifically rather than only the front schedule. Set consumerGuideProvided true ONLY on an " +
  "explicit acknowledgement actually present in this document — never infer it from the agreement " +
  "merely existing, or from the guide being a legal requirement. If the acknowledgement IS there and " +
  "states the date the guide was given, set eventDate to that date. If the acknowledgement is there " +
  "but no date is stated anywhere, still set consumerGuideProvided true, leave eventDate out, and say " +
  "in the note that the agreement confirms the guide was given but does not state the date, so the " +
  "agent needs to enter it — that is genuinely useful to them, and is an exception to the " +
  "no-restatement rule. If the document does not address the guide at all, leave a2 out rather than " +
  "guessing), " +
  "a3 (the date the " +
  "agency agreement was signed — put it in eventDate and write NO note. Do not report that the " +
  "agreement was signed, or by whom: the agent uploaded it and can see the signatures, so naming the " +
  "vendors back at them is the restatement the rule above forbids. Only write a note here if " +
  "something is genuinely wrong with the execution, for example it appears unsigned by a party, or " +
  "carries no date at all. ALSO on the a3 patch: the METHOD OF SALE, which a NSW selling agency " +
  "agreement normally states explicitly — set saleMethod, and where the method is auction and the " +
  "agreement gives a specific date and time, set auctionDate and auctionTime too. A blank or 'TBC' " +
  "auction date is normal at signing; omit the field rather than inventing one. Write no note about " +
  "any of this — it fills in fields the agent would otherwise re-key, and saying so adds nothing), " +
  "a4 (the ESP figures, only if explicitly stated in this " +
  "document — put them in espLow and espHigh and write NO note whatsoever. Where the document states " +
  "the date the vendor was given the ESP and the evidence for it, put that date in espGivenOn. " +
  "Do not describe the " +
  "figures, and above all do not characterise where they came from or what kind of estimate they " +
  "are: you cannot tell an agent's own appraisal from an automated valuation by looking at a number, " +
  "and guessing wrong puts a false claim about provenance beside a figure the agent has to defend " +
  "under s72A. Whether the range breaches the 10% spread is arithmetic, calculated from the figures " +
  "elsewhere, and is not your job), " +
  "a4c (the agent's own reasoning behind the ESP — this one item is an exception to the " +
  "note-flagging rule: if the document contains that reasoning text, copy it in the document's own " +
  "words, not paraphrased or summarised, for the agent to confirm, not just a gap-flag), " +
  "a3 (set offerPrice from the private-treaty offering price the agreement is required to specify " +
  "under Schedule 6 section 5 of the Regulation, copied exactly as written. This is NOT the estimated " +
  "selling price and must not be taken from the ESP field, and an auction agreement has none, so leave " +
  "it out rather than substituting a reserve or a guide), " +
  "a5 (commission, rebates, discounts and vendor-paid advertising, as disclosed to the vendor in " +
  "this agreement — s57), " +
  "a6 (the AGENCY AGREEMENT's own cooling-off period: one business day, under the Property and Stock " +
  "Agents Act. This is NOT the purchaser's cooling-off period on a contract for sale, which is five " +
  "business days under s66X of the Conveyancing Act — a different right, for a different party, " +
  "under a different Act. If what you are looking at is the s66X purchaser statement, that is not " +
  "this item: leave a6 out entirely), " +
  "a7 (material facts — set materialFactDisclosed from the vendor disclosure section, " +
  "true if the vendor disclosed something and false ONLY if that section is present, completed, and " +
  "records nothing to disclose. If the section is missing, blank or partly filled, omit the field so " +
  "the agent answers it themselves — silence is not a 'no'. The statutory warnings printed on every " +
  "form — loose-fill asbestos, smoke alarms — are NOT a vendor disclosure and must never be read as " +
  "one).";

// One target, deliberately.
//
// This used to open with an a4b clause asking for one sentence on whether
// comparable-sales evidence was present at all. a4b was merged into a4 on
// 22 Aug 2026 and that question went with it: the report is now attached to
// the ESP card itself, so "evidence is present" is answered by the file
// sitting there, and saying it in words as well is the restatement the rule
// above forbids.
//
// Nothing here may touch the ESP figures. They come off the agency agreement
// under s72A, and a provider's automated estimate is not the figure the agent
// agreed. SOURCE_TARGETS enforces that in code; this is only the reminder.
export const COMPARABLES_PROMPT =
  "a4c, and on a4c please do these things.\n\n" +
  "(1) comparableSales — every sold property this document shows, wherever and however it is set out " +
  "(a table, a list, a paragraph, a caption under a photo, a map key), as one entry each, in the " +
  "document's own order. This is the main job. Transcribe what is printed and nothing else: address, price, date of " +
  "sale, beds, baths, car, land size, internal area, distance. Leave a field out rather than " +
  "estimating it, except that beds, baths and car spaces of 0 (or 'nil', 'none') are recorded as 0: a 0 " +
  "is an answer, not a gap. The same goes for the subject property and the listings for sale. " +
  "Include every sale, even ones that look unlike the subject — deciding which sales " +
  "count is the agent's job, and a sale you silently omitted is one they cannot consider.\n\n" +
  "(2) subjectProperty — the attributes of the property the report was prepared FOR, which these " +
  "reports normally state on the first page. Beds, baths, car, land, internal area. Omit anything not " +
  "printed. Do not confuse it with the nearest comparable.\n\n" +
  "(2b) marketListings — every property the report shows as currently FOR SALE (not sold), as one " +
  "entry each, in the report's order. Address, the advertised price or guide copied exactly as printed " +
  "(it is another agent's asking price, not a sale price — never turn a range into one number), sale " +
  "method, listed date if a date is printed, beds, baths, car, land, distance. Many reports have no " +
  "for-sale section; if so, leave this out.\n\n" +
  "(3) note — the agent's own reasoning behind the ESP, ONLY if this report actually contains " +
  "reasoning written by the agent rather than the provider's automated commentary. Copy it in the " +
  "report's own words; do not paraphrase or summarise. If all you can see " +
  "is generated text, leave note out entirely.\n\n" +
  "Return no other item. In particular, do not return an estimated selling price: any range printed " +
  "in this report is the provider's automated estimate, not the figure the agent recorded in the " +
  "agency agreement, and it will be discarded. And do not say which comparables are the good ones — " +
  "record the sales, let the agent weigh them.";

export function promptForSource(source: SourceKey, prescribedDocs: PrescribedDoc[]): string {
  if (source === "b1") return prescribedDocsPrompt(prescribedDocs);
  if (source === "a4") return COMPARABLES_PROMPT;
  return AGENCY_AGREEMENT_PROMPT;
}

/**
 * The most a listing document's answer may run to. The sample comparable-sales
 * reports (lib/documents/sample-cmas) fail on every pull request if this is
 * ever set back to 1,536, the limit that silently dropped the comparables
 * until 30 Oct 2026 (PR #95).
 */
export const LISTING_READER_MAX_TOKENS = 16000;

/**
 * Reads one listing document (the agency agreement, the contract for sale or
 * the comparable-sales report) and returns what it found, item by item. Never
 * writes anything. The file is given whole: the app downloads it from the
 * card, the sample-report tests and the daily check hand over a sample.
 *
 * Throws on a failed read (lib/documents/read-core readFailure says it in
 * words): a file too large or of a kind it can't take, or an answer that was
 * cut off, refused, missing or unusable. Never returns "nothing found" for
 * a read that didn't finish.
 */
export async function readListingDocument(args: {
  anthropic: Anthropic;
  blob: Blob;
  fileName: string;
  source: SourceKey;
  prescribedDocs: PrescribedDoc[];
}): Promise<DraftPatch[]> {
  const { anthropic, blob, fileName, source, prescribedDocs } = args;
  const prepared = await prepareRead(blob, fileName);
  if (!prepared.ok) {
    if (prepared.problem === "too_large") throw new TooLargeToRead();
    throw new FileCantBeRead("unsupported", `file type not supported for extraction yet (${prepared.contentType})`);
  }

  // Deterministic backstop, not a prompt instruction: a real contract, agency
  // agreement, or comps report is never this short. Skip the model call
  // entirely rather than trust an LLM not to fabricate an answer about
  // content that plainly isn't a real source document — this caught a
  // confirmed hallucination (invented document names) that survived two
  // rounds of prompt-only fixes on a one-line placeholder test file.
  const MIN_TEXT_CHARS = 400;
  if (prepared.contentType === "text/plain") {
    const text = Buffer.from(prepared.bytes).toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      return [];
    }
  }

  const sourceLabel = SOURCE_LABELS[source] ?? source;
  const expected = EXPECTED_KIND[source];

  const question: PartQuestion = {
    // Room for a whole comparable-sales report (30 Oct 2026). The answer
    // lists every sale and every on-market listing the report holds, field by
    // field, and at 1,536 a report of about six sales already filled it: the
    // answer was cut off, read as "nothing found", and the comparables and
    // the reasoning draft never appeared. 16,000 keeps one answer inside
    // the time a request that isn't streamed is given; most answers use a
    // few hundred, and a long report a few thousand.
    maxTokens: LISTING_READER_MAX_TOKENS,
    system:
      "You are extracting facts from a real-estate compliance document for a NSW licensed agent's compliance " +
      "file (RealComply). This is diligence support only — the licensee reviews everything and decides, you do " +
      "not. Only extract facts the document explicitly and literally states. Never infer, estimate, guess, or " +
      "fill a gap with a plausible-sounding figure, date, or description — including describing what a document " +
      "is missing, lacks, or does not include. A statement about absence is exactly as fabricated as a wrong " +
      "figure if you cannot see the rest of the actual file to know it's true. You have been shown the complete " +
      "content available to you above — do not assume there are further pages, schedules, or attachments beyond " +
      "what is shown, and do not reason from what this type of document 'usually' or 'typically' contains. If " +
      "nothing relevant is written down for an item, or the content shown is too short, generic, or unrelated to " +
      "make a grounded finding, omit that item entirely — an empty patches array is correct and expected, not a " +
      "failure. Keep notes short, factual, and traceable to specific text you were actually shown. Never assert a " +
      "document is missing or doesn't exist unless you've actually looked through the whole document for it; " +
      "phrase that as 'not found in what I was shown', not a categorical claim. Treat " +
      "the note field as a place to flag something for the agent's attention — a gap, an ambiguity, a missing " +
      "detail, something needing their confirmation or follow-up — never as a summary or restatement of a fact " +
      "the document already states plainly. The agent has the source document open in front of them; telling " +
      "them again what it already says adds nothing. If an item is covered completely with nothing exceptional " +
      "about it, leave the note out of that item's patch (or send an empty string) — 'nothing to flag' is the " +
      "normal, expected, successful outcome, not a sign you should have found something to say. This doesn't " +
      "apply to structured fields (espLow, espHigh, eventDate): keep populating those whenever explicitly " +
      "stated, note or no note — a figure or date saves the agent real typing, unlike a restated sentence. You " +
      "must call record_findings exactly once, but calling it with an empty patches array is a completely " +
      "normal, successful, and common outcome — do not stretch to fill the array with a weak or unsupported " +
      "finding just because you're calling the tool.",
    text: (partIndex) =>
      (partIndex === 1 && source === "a4"
        ? // Any format (Adam, 11 Nov 2026): see READ_FOR_SALES_WHATEVER_IT_IS below.
          "This document was uploaded as the evidence for the estimated selling price. That evidence comes in " +
          "every format: a provider's report, the agent's own appraisal or comparative market analysis, a letter " +
          "or proposal to the vendor, a few pages taken from any of these, or a scan. FIRST set documentIs from " +
          "what the document actually is. THEN, whatever its format, call record_findings with any facts it " +
          "explicitly and literally states "
        : partIndex === 1
        ? `This document was uploaded as the ${sourceLabel}, but do not take that on trust — the wrong ` +
          "file is uploaded often enough to matter, and reading the wrong document produces answers that " +
          "look right and are not. FIRST set documentIs from what the document actually is. THEN, only if " +
          `it really is the ${sourceLabel}, call record_findings with any facts it ` +
          "explicitly and literally states "
        : // A later part of a split file: its first pages have already been
          // checked and are the right document. Its own pages may be
          // annexures that look like something else on their own, and they
          // still count (a prescribed document is usually one of them).
          `These pages continue the ${sourceLabel}: its first pages were read separately and confirmed as ` +
          `the ${sourceLabel}, so set documentIs to ${expected}, whatever these pages look like on their own ` +
          "(annexures and attachments are part of it). Call record_findings with any facts these pages " +
          "explicitly and literally state ") +
      "that are relevant to these compliance items: " +
      promptForSource(source, prescribedDocs) +
      "\n\nFor every item: only report what is directly readable in the content above; " +
      "if you're not looking at something substantial enough to ground a finding, leave that item out " +
      "rather than filling it in.",
    tool: EXTRACTION_TOOL,
  };

  // The first part says what the document is. A whole file is one part, read
  // exactly as before.
  const [first] = await askParts(anthropic, prepared.parts.slice(0, 1), question);
  if (!first) return [];

  const input = first as { patches?: DraftPatch[]; documentIs?: DocumentKind };

  // The wrong file in this slot. Record that, and NOTHING else from it.
  //
  // This is the whole point of the 20 Aug rewrite. Previously the model could
  // say "this is the agency agreement, not a contract" in a note and still
  // return a full prescribedDocs array alongside it, which rendered as nine
  // green ticks against s52A on the strength of a document that is not a
  // contract. Both halves came back in the same tool call and nothing
  // reconciled them.
  //
  // READ_FOR_SALES_WHATEVER_IT_IS. Not on the ESP card (Adam, 11 Nov 2026:
  // "We can't have people uploading CMA files... they're always all going to
  // be different... the AI just needs to read it and pull out the relevant
  // data"). REVERSAL of the 20 Aug rule for the ESP card only. Four reports
  // from four offices (5 and 11 Nov) were judged "a different kind of
  // document" and nothing was taken from them: an agent's own appraisal, a
  // few pages cut from a bigger report. Now every file on the ESP card is read
  // for sales. It is the wrong file only when it is plainly the agreement or
  // the contract AND no sales were found in it (wrongFileOnEspCard below). A
  // file with no sales is "no sales found", and the agent can add them. The
  // comparables are the agent's to check and weigh either way. The agreement
  // and the contract keep the rule: there a wrong document gives false ticks.
  const actual = input.documentIs;
  const wrongDocument = (kind: DocumentKind): DraftPatch => ({
    itemKey: source,
    wrongDocument: { expected: KIND_LABELS[expected], actual: KIND_LABELS[kind] },
    // Kept in step with the older flag so a b1 card written either side of
    // this change behaves the same way.
    ...(source === "b1" ? { notAContract: true } : {}),
  });
  if (actual && actual !== expected && source !== "a4") return [wrongDocument(actual)];

  // The rest of a split file, then every part's answers as one answer per
  // item (lib/documents/reader-parts mergeReads: a prescribed document found
  // in any part is found; the first part to state a figure gives it).
  // A whole file is used exactly as it was read.
  let patches = input.patches ?? [];
  if (prepared.parts.length > 1) {
    const rest = await askParts(anthropic, prepared.parts.slice(1), question, 2);
    const byItem = new Map<string, DraftPatch[]>();
    for (const read of [input, ...(rest as Array<{ patches?: DraftPatch[] }>)].flatMap((r) => r.patches ?? [])) {
      if (!read?.itemKey) continue;
      // A part's note about its own pages, or about something not being
      // there, isn't true of the whole document (see isPartOnlyNote).
      const patch = read.note && isPartOnlyNote(read.note) ? { ...read, note: undefined } : read;
      byItem.set(patch.itemKey, [...(byItem.get(patch.itemKey) ?? []), patch]);
    }
    patches = [...byItem.values()].map((list) => (list.length === 1 ? list[0] : mergeReads(list)));
  }

  const kept = patches
    .filter((p) => TARGET_ITEM_KEYS.has(p.itemKey))
    // The rule this file exists to enforce. A document only speaks to the
    // items it can actually evidence, whatever the model chose to return.
    .filter((p) => SOURCE_TARGETS[source].has(p.itemKey))
    // prescribedDocs is a b1 answer and only a b1 answer, and so is the
    // council area: an agency agreement's or a report's mention of a council
    // is not the planning certificate.
    .map((p) => (source === "b1" ? p : { ...p, prescribedDocs: undefined, notAContract: undefined, councilArea: undefined }))
    // materialFactDisclosed is the vendor's declaration in the agency
    // agreement. Nothing else may set it — a wrong "none disclosed" writes a
    // record the vendor never made and silently removes e2 later in the file.
    .map((p) => (source === "a3" ? p : { ...p, materialFactDisclosed: undefined }))
    // Comparables and the subject's own attributes come off the comparables
    // report and nowhere else. The agency agreement also writes to a4c, so
    // without this an agreement that happened to mention a nearby sale could
    // put a row in the comparison table — a sale that is not in the report the
    // file holds as evidence, appearing in the record as though it were.
    .map((p) =>
      source === "a4" ? p : { ...p, comparableSales: undefined, subjectProperty: undefined, marketListings: undefined },
    );

  if (source === "a4" && wrongFileOnEspCard(actual, kept)) return [wrongDocument(actual!)];
  return kept;
}

/**
 * The ESP card's one wrong file (READ_FOR_SALES_WHATEVER_IT_IS above): the
 * agency agreement or the contract, with no sales in it. An agreement with
 * the comparable sales attached to it is read for them.
 */
export function wrongFileOnEspCard(actual: DocumentKind | undefined, patches: DraftPatch[]): boolean {
  if (actual !== "agency_agreement" && actual !== "contract_for_sale") return false;
  return !patches.some((p) => (p.comparableSales?.length ?? 0) > 0 || (p.marketListings?.length ?? 0) > 0);
}
