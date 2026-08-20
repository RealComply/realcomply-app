"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { getItem } from "@/lib/rules/nsw-sales";
import {
  PRESCRIBED_DOC_KEYS,
  prescribedDocumentsFor,
  type PrescribedDoc,
} from "@/lib/rules/nsw-prescribed-documents";
import type { PropertyItem } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

// The three setup-time documents (property creation form) and which item
// each is attached to as evidence — see src/lib/actions/properties.ts.
const SOURCE_ITEM_KEYS = ["a3", "b1", "a4b"] as const;
type SourceKey = (typeof SOURCE_ITEM_KEYS)[number];

const SOURCE_LABELS: Record<string, string> = {
  a3: "agency agreement",
  b1: "contract for sale",
  a4b: "comparable-sales report",
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
const SOURCE_TARGETS: Record<SourceKey, ReadonlySet<string>> = {
  a3: new Set(["a1", "a2", "a3", "a4", "a4c", "a5", "a6", "a7"]),
  b1: new Set(["b1"]),
  // The ESP itself belongs in the agency agreement (s72A); a comparables
  // report may suggest a range but that is not the figure the agent agreed.
  a4b: new Set(["a4b", "a4c"]),
};

// What the document turned out to be, as opposed to which box it was uploaded
// into. The model answers this first, on every read.
type DocumentKind = "agency_agreement" | "contract_for_sale" | "comparable_sales" | "other";

const EXPECTED_KIND: Record<SourceKey, DocumentKind> = {
  a3: "agency_agreement",
  b1: "contract_for_sale",
  a4b: "comparable_sales",
};

const KIND_LABELS: Record<DocumentKind, string> = {
  agency_agreement: "an agency agreement",
  contract_for_sale: "a contract for sale of land",
  comparable_sales: "a comparable-sales report",
  other: "a different kind of document",
};

// Only these items can ever be patched by extraction — a hard allow-list,
// independent of whatever the model returns. Deliberately excludes every
// licenseeOnly item (amc, f1, sign_licensee) and every log-style item
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
const TARGET_ITEM_KEYS = new Set(["a1", "a2", "a3", "a4", "a4b", "a4c", "a5", "a6", "a7", "b1"]);

// One verdict per prescribed document, for item b1. "found" and "not_found"
// are both real answers; there is no "unclear" because a document the model
// cannot positively identify has, for the agent's purposes, not been found —
// and the wording shown to them says exactly that rather than claiming the
// contract is deficient.
export type PrescribedDocVerdict = {
  key: string;
  found: boolean;
};

type DraftPatch = {
  itemKey: string;
  note?: string;
  espLow?: number;
  espHigh?: number;
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
};

const EXTRACTION_TOOL: Anthropic.Tool = {
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
          "'comparable_sales' — a comparable-sales or market-appraisal report (Cotality, PropTrack or similar). " +
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
                "Only something the agent needs to act on or confirm — a gap, an inconsistency, a missing detail. Never a restatement of a fact the document already states clearly (e.g. do not write 'commission is 2.2%, as stated in clause 4' — that tells the agent nothing they don't already have in front of them). Leave this out entirely, or send an empty string, when the document covers the item completely with nothing exceptional to flag. Exception: for a4c specifically, this field instead carries a short paraphrase of the agent's own ESP reasoning if the document contains it, as an editable starting draft — not a gap-flag.",
            },
            espLow: {
              type: "number",
              description: "Item a4 only — low end of an estimated selling price, only if the document explicitly states a figure.",
            },
            espHigh: {
              type: "number",
              description: "Item a4 only — high end, only if explicitly stated.",
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
function prescribedDocsPrompt(docs: PrescribedDoc[]): string {
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
    "found/not-found answers cannot express, such as a certificate that is visibly for a different property."
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

const AGENCY_AGREEMENT_PROMPT =
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
  "document — put them in espLow and espHigh and write NO note whatsoever. Do not describe the " +
  "figures, and above all do not characterise where they came from or what kind of estimate they " +
  "are: you cannot tell an agent's own appraisal from an automated valuation by looking at a number, " +
  "and guessing wrong puts a false claim about provenance beside a figure the agent has to defend " +
  "under s72A. Whether the range breaches the 10% spread is arithmetic, calculated from the figures " +
  "elsewhere, and is not your job), " +
  "a4c (the agent's own reasoning behind the ESP — this one item is an exception to the " +
  "note-flagging rule: if the document contains that reasoning text, paraphrase it as a short " +
  "editable starting draft for the agent to refine, not just a gap-flag), " +
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

const COMPARABLES_PROMPT =
  "a4b (whether comparable-sales evidence is present " +
  "at all — say so in ONE short sentence and stop. Do not list the comparable addresses, prices or " +
  "counts: the agent uploaded this document and has it open, so enumerating its contents back at " +
  "them is the restatement the rule above forbids. Do not comment on whether the agent has explained " +
  "how the comparables relate to the ESP, or on the absence of that reasoning — that belongs to a4c, " +
  "which has its own card directly below this one for exactly that purpose, and flagging it here " +
  "reads as a gap in the wrong place), " +
  "a4c (the agent's own reasoning behind the ESP, ONLY if this report actually contains reasoning " +
  "written by the agent rather than the provider's own automated commentary — paraphrase it as a " +
  "short editable starting draft. If all you can see is the provider's generated text, leave a4c out).";

function promptForSource(source: SourceKey, prescribedDocs: PrescribedDoc[]): string {
  if (source === "b1") return prescribedDocsPrompt(prescribedDocs);
  if (source === "a4b") return COMPARABLES_PROMPT;
  return AGENCY_AGREEMENT_PROMPT;
}

// f3 — pre-purchase inspection report register (cl 37, Property and Stock
// Agents Regulation 2022). Separate tool/schema from record_findings above:
// the fields a report register needs (preparer contact, PI-insured,
// available-for-repurchase) don't fit the property_items aiDraft shape, and
// this never writes to the DB itself — it just returns what it found so the
// agent can review it in the "log a report" form before saving, same
// diligence-support framing as everywhere else.
const REPORT_EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_report_details",
  description:
    "Record pre-purchase inspection report details explicitly and literally stated in the document. Omit any " +
    "field not stated — never guess, infer, or assume a false/negative value for something the document simply " +
    "doesn't mention.",
  input_schema: {
    type: "object",
    properties: {
      pestInspection: {
        type: "boolean",
        description: "True only if this document is or includes a pest/termite inspection report.",
      },
      buildingInspection: {
        type: "boolean",
        description: "True only if this document is or includes a building inspection report.",
      },
      strata: {
        type: "boolean",
        description:
          "True only if this document is a strata report — a strata scheme document inspection or a strata financial certificate.",
      },
      inspectionDate: {
        type: "string",
        description: "The date the property was inspected for this report, only if explicitly stated. Format YYYY-MM-DD.",
      },
      preparerName: {
        type: "string",
        description: "The name of the person or business that prepared/issued the report, only if stated.",
      },
      preparerContact: {
        type: "string",
        description: "The preparer's business address and/or phone number, only if stated.",
      },
      preparerInsured: {
        type: "boolean",
        description:
          "True only if the document explicitly states the preparer holds professional indemnity insurance. " +
          "Omit this field entirely if insurance isn't mentioned at all — never assume false just because it " +
          "isn't stated.",
      },
      availableForRepurchase: {
        type: "boolean",
        description:
          "True only if the document explicitly states the report is available for purchase or reissue to " +
          "another party. Omit if not mentioned.",
      },
    },
    required: [],
  },
};

// ── CPD certificate ────────────────────────────────────────────────────────
//
// A record of completion from an approved provider states everything the CPD
// register needs: the provider, the topic, the hours, the date and whether
// assessment was passed. Fair Trading requires providers to issue it within
// 10 business days and prescribes what it contains — which makes it about the
// most reliably structured document this product reads.
//
// So the agent uploads it and types nothing (Adam, 18 Aug 2026: "all the
// information we need will be on the certificate... less friction, less
// manual data entry"). Same diligence-support framing as every other
// extraction: this returns what it found, the agent confirms it, and nothing
// is written to the database by the model.
const CPD_CERTIFICATE_TOOL: Anthropic.Tool = {
  name: "record_cpd_certificate",
  description:
    "Record the details stated on a CPD record of completion or statement of attainment. Omit any field the " +
    "document does not explicitly state — never guess a provider, a date or an hours figure.",
  input_schema: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        description:
          "The organisation that delivered the training and issued this record — e.g. REINSW, or the RTO named " +
          "on a statement of attainment. Only if stated.",
      },
      activityName: {
        type: "string",
        description:
          "The title of the topic, course or unit of competency completed, as printed. For a unit of " +
          "competency include its code if shown (e.g. 'CPPREP4001 Prepare for professional practice').",
      },
      hours: {
        type: "number",
        description:
          "Duration in hours, only if the document states it numerically. Do not convert a session time range " +
          "into hours yourself, and do not state hours for a unit of competency that is measured in units.",
      },
      units: {
        type: "number",
        description:
          "Number of units of competency this document evidences — normally 1 for a statement of attainment " +
          "covering a single unit. Only set this for units of competency, never alongside hours.",
      },
      completedDate: {
        type: "string",
        description: "The date the activity was completed or the assessment passed, if stated. Format YYYY-MM-DD.",
      },
      deliveryMode: {
        type: "string",
        description:
          "How it was delivered, if stated — e.g. 'face-to-face', 'live webinar', 'online'. Copy what the " +
          "document says rather than categorising it.",
      },
      assessmentPassed: {
        type: "boolean",
        description:
          "True only if the document explicitly records a satisfactory or competent assessment result. Omit " +
          "entirely if assessment is not mentioned — never assume false.",
      },
      looksLikeCpdCertificate: {
        type: "boolean",
        description:
          "False if this document does not appear to be a CPD record of completion or statement of attainment " +
          "at all. Set this rather than inventing fields for an unrelated document.",
      },
    },
    required: [],
  },
};

export type CpdCertificateFields = {
  provider?: string;
  activityName?: string;
  hours?: number;
  units?: number;
  completedDate?: string;
  deliveryMode?: string;
  assessmentPassed?: boolean;
  looksLikeCpdCertificate?: boolean;
};

/** Reads an uploaded CPD certificate. Never writes — the agent confirms. */
export async function extractCpdCertificate(
  path: string,
  fileName: string,
): Promise<{ error: string | null; fields?: CpdCertificateFields }> {
  const { supabase } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI reading isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
  }

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) return { error: "Couldn't download the uploaded file." };

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = blob.type || "application/octet-stream";

  const documentBlock = buildDocumentBlock(contentType, base64, fileName);
  if (!documentBlock) {
    return { error: `That file type can't be read yet (${contentType}) — the details can be typed in instead.` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system:
      "You are reading a continuing professional development record of completion, or a statement of " +
      "attainment, for a NSW licensed real estate agent's CPD register (RealComply). Record only what the " +
      "document explicitly and literally states. Never infer, estimate or convert — if it gives a start and " +
      "end time but no duration, do not calculate hours. If it does not name a provider, do not guess one from " +
      "a logo or a filename. You have been shown the complete content available to you; do not assume further " +
      "pages exist. You must call record_cpd_certificate exactly once, but calling it with few fields set is a " +
      "completely normal and successful outcome — the agent reviews and completes it, you do not.",
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text: `This was uploaded as "${fileName}" for a CPD register. Call record_cpd_certificate with whatever it explicitly states.`,
          },
        ],
      },
    ],
    tools: [CPD_CERTIFICATE_TOOL],
    tool_choice: { type: "tool", name: "record_cpd_certificate" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return { error: null, fields: {} };

  return { error: null, fields: toolUse.input as CpdCertificateFields };
}

// ── Identity-document screen ───────────────────────────────────────────────
//
// Adam, 20 Aug 2026: "if the AI can detect any ID documents, then it rejects
// them, and tells the agent that copies of identifiable documentation are not
// to be uploaded into RealComply."
//
// This exists because the warning on a1 is only words, and the natural thing
// for an agent to reach for when asked to prove identity was verified is the
// licence scan. Storing those would put RealComply under Privacy Act APP 11
// obligations it is not built for today.
//
// THE DISTINCTION THIS HAS TO GET RIGHT. a1 asks for the VOI certificate or
// signing audit trail — the record that a check happened. Some of those (ZipID,
// IDVerse) reproduce the licence details, and a few embed a thumbnail of the
// document checked. Rejecting on "an ID appears anywhere" would therefore
// reject the very document the card asks for. So the test is what the file IS,
// not what it mentions: a copy of someone's ID is refused, a report about
// checking someone's ID is accepted.
const ID_SCREEN_TOOL: Anthropic.Tool = {
  name: "screen_for_identity_documents",
  description:
    "Decide whether an uploaded file is a copy of a personal identity document, which must not be stored.",
  input_schema: {
    type: "object",
    properties: {
      isIdentityDocument: {
        type: "boolean",
        description:
          "TRUE if this file is, in substance, a copy of one or more personal identity documents — a scan, " +
          "photo or screenshot of a driver's licence, passport, birth certificate, Medicare card, citizenship " +
          "certificate, proof-of-age card, visa grant, or similar. Also true for a file that is mostly such " +
          "copies with a cover page attached. " +
          "FALSE for a report ABOUT an identity check: a verification-of-identity certificate, an identity " +
          "verification report, an e-signing completion certificate or audit trail, a CDD or KYC outcome " +
          "summary. Those are records that a check was performed and are exactly what this product asks for — " +
          "answer FALSE even when they quote licence numbers, document numbers or expiry dates, and even when " +
          "they include a small thumbnail of the document that was checked. The question is what the file IS, " +
          "not what it mentions. " +
          "FALSE for ordinary conveyancing paperwork: agency agreements, contracts, certificates of title, " +
          "planning certificates, inspection reports, comparable-sales reports. " +
          "If you genuinely cannot tell, answer FALSE — a wrong rejection blocks an agent from filing a " +
          "legitimate record, and the agent has been warned in writing not to upload ID.",
      },
      documentKind: {
        type: "string",
        description:
          "Two or three words naming what the file appears to be, e.g. 'a driver's licence', 'a passport " +
          "photo page', 'a VOI certificate'. Used to tell the agent what was refused.",
      },
    },
    required: ["isIdentityDocument"],
  },
};

/**
 * Screens one already-uploaded file. Returns null when the file is fine, or a
 * short description of what it looks like when it must be refused.
 *
 * FAILS OPEN. If the API key is missing, the download fails, or the model
 * errors, this returns null and the upload proceeds. That is a deliberate
 * trade: a screen that blocks every attachment whenever an external service
 * hiccups would stop agents filing compliance records, and the written warning
 * on the card is still in place. It does mean the screen is a safety net, not
 * a guarantee — flagged to Adam.
 */
export async function screenForIdDocument(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  path: string,
  fileName: string,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) return null;

    const arrayBuffer = await blob.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const documentBlock = buildDocumentBlock(blob.type || "application/octet-stream", base64, fileName);
    // A file type we cannot read cannot be screened. Let it through rather
    // than refusing on the basis of not having looked.
    if (!documentBlock) return null;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 256,
      system:
        "You are screening a file an Australian real-estate agent is attaching to a compliance record, to " +
        "keep copies of personal identity documents out of the system. Judge only what you were shown. " +
        "Answer FALSE when uncertain: refusing a legitimate compliance record is a real cost, and this screen " +
        "backs up a written warning rather than replacing it.",
      messages: [
        {
          role: "user",
          content: [
            documentBlock,
            {
              type: "text",
              text: `This was uploaded as "${fileName}". Call screen_for_identity_documents.`,
            },
          ],
        },
      ],
      tools: [ID_SCREEN_TOOL],
      tool_choice: { type: "tool", name: "screen_for_identity_documents" },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
    );
    if (!toolUse) return null;

    const result = toolUse.input as { isIdentityDocument?: boolean; documentKind?: string };
    if (!result.isIdentityDocument) return null;
    return result.documentKind?.trim() || "an identity document";
  } catch (err) {
    console.error("ID screen failed, allowing upload:", fileName, err);
    return null;
  }
}

export type ReportExtractionFields = {
  pestInspection?: boolean;
  buildingInspection?: boolean;
  strata?: boolean;
  inspectionDate?: string;
  preparerName?: string;
  preparerContact?: string;
  preparerInsured?: boolean;
  availableForRepurchase?: boolean;
};

// Downloads an already-uploaded report document (the agent uploads it
// client-side first, same direct-to-Storage pattern as every other evidence
// upload in this app — see src/lib/storage/evidence.ts) and reads off
// whatever cl 37 fields are explicitly stated, for the agent to review and
// complete before logging the register entry. Never writes to the DB.
export async function extractReportDetails(
  path: string,
  fileName: string,
): Promise<{ error: string | null; fields?: ReportExtractionFields }> {
  const { supabase } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI extraction isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
  }

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    return { error: "Couldn't download the uploaded file." };
  }

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = blob.type || "application/octet-stream";

  const MIN_TEXT_CHARS = 400;
  if (contentType === "text/plain") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      return { error: null, fields: {} };
    }
  }

  const documentBlock = buildDocumentBlock(contentType, base64, fileName);
  if (!documentBlock) {
    return { error: `File type not supported for extraction yet (${contentType}).` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    system:
      "You are reading a pre-purchase inspection report (pest, building, or strata) for a NSW licensed agent's " +
      "compliance file (RealComply), to help them fill in their cl 37 report register. This is diligence support " +
      "only — the agent reviews and confirms everything before it's saved, you do not. Only record a field if " +
      "the document explicitly and literally states it. Never infer, estimate, or assume a value — especially " +
      "for preparerInsured, where 'not mentioned' must be left out entirely, never recorded as false. You have " +
      "been shown the complete content available to you — do not assume further pages exist. If the document " +
      "doesn't look like a genuine pest, building, or strata report at all, call the tool with an empty object " +
      "rather than guessing at any field. You must call record_report_details exactly once, but calling it with " +
      "few or no fields set is a completely normal, successful, and common outcome — do not stretch to fill in " +
      "a field you're not actually seeing stated.",
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text: `This document was uploaded as "${fileName}" for the pre-purchase inspection report register. Call record_report_details with whatever it explicitly states.`,
          },
        ],
      },
    ],
    tools: [REPORT_EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_report_details" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return { error: null, fields: {} };

  return { error: null, fields: toolUse.input as ReportExtractionFields };
}

function buildDocumentBlock(
  contentType: string,
  base64: string,
  fileName: string,
): Anthropic.Messages.ContentBlockParam | null {
  if (contentType === "application/pdf") {
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  }
  if (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(contentType)) {
    return {
      type: "image",
      source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
    };
  }
  if (contentType === "text/plain") {
    return {
      type: "text",
      text: `Document "${fileName}":\n\n${Buffer.from(base64, "base64").toString("utf-8")}`,
    };
  }
  return null;
}

async function extractOneDocument(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  anthropic: Anthropic,
  item: PropertyItem,
  prescribedDocs: PrescribedDoc[],
): Promise<DraftPatch[]> {
  const source = item.item_key as SourceKey;
  const path = item.evidence_path;
  if (!path) return [];

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    throw new Error("couldn't download the file");
  }

  const arrayBuffer = await blob.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const contentType = blob.type || "application/octet-stream";
  const fileName =
    (item.data as { evidenceFileName?: string } | null)?.evidenceFileName ?? path.split("/").pop() ?? "document";

  // Deterministic backstop, not a prompt instruction: a real contract, agency
  // agreement, or comps report is never this short. Skip the model call
  // entirely rather than trust an LLM not to fabricate an answer about
  // content that plainly isn't a real source document — this caught a
  // confirmed hallucination (invented document names) that survived two
  // rounds of prompt-only fixes on a one-line placeholder test file.
  const MIN_TEXT_CHARS = 400;
  if (contentType === "text/plain") {
    const text = Buffer.from(base64, "base64").toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      return [];
    }
  }

  const documentBlock = buildDocumentBlock(contentType, base64, fileName);
  if (!documentBlock) {
    throw new Error(`file type not supported for extraction yet (${contentType})`);
  }

  const sourceLabel = SOURCE_LABELS[item.item_key] ?? item.item_key;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1536,
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
    messages: [
      {
        role: "user",
        content: [
          documentBlock,
          {
            type: "text",
            text:
              `This document was uploaded as the ${sourceLabel}, but do not take that on trust — the wrong ` +
              "file is uploaded often enough to matter, and reading the wrong document produces answers that " +
              "look right and are not. FIRST set documentIs from what the document actually is. THEN, only if " +
              `it really is the ${sourceLabel}, call record_findings with any facts it ` +
              "explicitly and literally states that are relevant to these compliance items: " +
              promptForSource(source, prescribedDocs) +
              "\n\nFor every item: only report what is directly readable in the content above; " +
              "if you're not looking at something substantial enough to ground a finding, leave that item out " +
              "rather than filling it in.",
          },
        ],
      },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_findings" },
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock => block.type === "tool_use",
  );
  if (!toolUse) return [];

  const input = toolUse.input as { patches?: DraftPatch[]; documentIs?: DocumentKind };

  // The wrong file in this slot. Record that, and NOTHING else from it.
  //
  // This is the whole point of the 20 Aug rewrite. Previously the model could
  // say "this is the agency agreement, not a contract" in a note and still
  // return a full prescribedDocs array alongside it, which rendered as nine
  // green ticks against s52A on the strength of a document that is not a
  // contract. Both halves came back in the same tool call and nothing
  // reconciled them.
  const actual = input.documentIs;
  const expected = EXPECTED_KIND[source];
  if (actual && actual !== expected) {
    return [
      {
        itemKey: source,
        wrongDocument: { expected: KIND_LABELS[expected], actual: KIND_LABELS[actual] },
        // Kept in step with the older flag so a b1 card written either side of
        // this change behaves the same way.
        ...(source === "b1" ? { notAContract: true } : {}),
      },
    ];
  }

  return (input.patches ?? [])
    .filter((p) => TARGET_ITEM_KEYS.has(p.itemKey))
    // The rule this file exists to enforce. A document only speaks to the
    // items it can actually evidence, whatever the model chose to return.
    .filter((p) => SOURCE_TARGETS[source].has(p.itemKey))
    // prescribedDocs is a b1 answer and only a b1 answer.
    .map((p) => (source === "b1" ? p : { ...p, prescribedDocs: undefined, notAContract: undefined }))
    // materialFactDisclosed is the vendor's declaration in the agency
    // agreement. Nothing else may set it — a wrong "none disclosed" writes a
    // record the vendor never made and silently removes e2 later in the file.
    .map((p) => (source === "a3" ? p : { ...p, materialFactDisclosed: undefined }));
}


// Reads whichever setup documents were attached (agency agreement, contract
// for sale, comparable-sales report) and writes what it finds into each
// target item's data.aiDraft — never into note/status/event_date directly,
// with one narrow, deliberate exception: a2 (consumer guide given before
// signing) can be auto-marked "done" outright when the document explicitly
// confirms it with a date — see the autoComplete check below, added per
// Adam's explicit instruction rather than the general product default. Every
// other item stays "open" and untouched either way; ItemCard reads aiDraft
// as a pre-fill default that the agent can edit or discard before saving,
// per the product's diligence-support framing.
// onlyItemKey scopes the run to a single attachment. Used when a document is
// attached, where re-reading the other two would burn AI calls on files that
// have not changed. Omitted for the page-level "Extract from uploaded
// documents" button, which still sweeps everything.
export async function extractFromDocuments(propertyId: string): Promise<ActionState> {
  return runExtraction(propertyId);
}

// Called after a document is attached. No-ops silently unless the file landed
// on one of the three items the AI actually reads, so attaching a pool
// certificate or a photo does not spend an AI call.
export async function extractForAttachment(propertyId: string, itemKey: string): Promise<ActionState> {
  if (!(SOURCE_ITEM_KEYS as readonly string[]).includes(itemKey)) return ok;
  return runExtraction(propertyId, itemKey);
}

async function runExtraction(propertyId: string, onlyItemKey?: string): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      error: "AI extraction isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first.",
    };
  }

  // Drives which s52A prescribed documents the contract is checked against —
  // a strata lot needs the strata plan and by-laws where a house needs the
  // deposited plan. Defaults to the non-strata list if the flag was never set
  // at property setup, which is the more common listing and errs towards
  // asking about a document that turns out not to apply rather than silently
  // skipping one that does.
  const { data: propertyRow } = await supabase
    .from("properties")
    .select("is_strata")
    .eq("id", propertyId)
    .maybeSingle();
  const prescribedDocs = prescribedDocumentsFor({
    isStrata: (propertyRow as { is_strata?: boolean | null } | null)?.is_strata ?? false,
  });

  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .in("item_key", SOURCE_ITEM_KEYS);

  // Read in a fixed order rather than whatever the database returned. a4c
  // (ESP reasoning) is the one item two documents may both speak to, and the
  // later write wins — so the agency agreement goes last and its version of
  // the agent's reasoning is the one that survives.
  const READ_ORDER: SourceKey[] = ["b1", "a4b", "a3"];
  const withEvidence = ((rows ?? []) as PropertyItem[])
    .filter((i) => i.evidence_path)
    .filter((i) => !onlyItemKey || i.item_key === onlyItemKey)
    .sort((x, y) => READ_ORDER.indexOf(x.item_key as SourceKey) - READ_ORDER.indexOf(y.item_key as SourceKey));

  // Whether the agency agreement itself was among the documents read. Only if
  // it was can we conclude anything about the consumer-guide acknowledgement:
  // a run scoped to the contract or the comparables says nothing either way.
  const readAgencyAgreement = withEvidence.some((i) => i.item_key === "a3");

  if (withEvidence.length === 0) {
    return {
      error: "No documents attached yet — attach the agency agreement, contract, or comparable-sales report first.",
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const patches: DraftPatch[] = [];
  const failures: string[] = [];

  for (const item of withEvidence) {
    try {
      patches.push(...(await extractOneDocument(supabase, anthropic, item, prescribedDocs)));
    } catch (err) {
      failures.push(`${SOURCE_LABELS[item.item_key] ?? item.item_key}: ${err instanceof Error ? err.message : "extraction failed"}`);
    }
  }

  // Method of sale and the auction date, lifted off the agency agreement.
  //
  // This writes to the PROPERTY, not an item, so it gets its own narrow pass
  // with a rule the item patches don't need: it only ever FILLS A BLANK. If
  // the agent has already said this is an auction, or already put a date in,
  // the model does not get to overwrite them — the agent knows whether the
  // auction moved and the twelve-week-old agreement does not.
  const salePatch = patches.find((p) => p.itemKey === "a3" && p.saleMethod);
  if (salePatch) {
    const { data: current } = await supabase
      .from("properties")
      .select("sale_method, auction_date, auction_time")
      .eq("id", propertyId)
      .maybeSingle();

    const row = current as
      | { sale_method?: string; auction_date?: string | null; auction_time?: string | null }
      | null;
    const update: Record<string, unknown> = {};

    if (salePatch.saleMethod === "auction" && row?.sale_method !== "auction") {
      update.sale_method = "auction";
    }
    // Date and time only where the file has none. Guarded on the agreement
    // actually saying auction, so a private-treaty agreement can never leave
    // an auction date behind on the record.
    if (salePatch.saleMethod === "auction") {
      if (salePatch.auctionDate && !row?.auction_date) update.auction_date = salePatch.auctionDate;
      if (salePatch.auctionTime && !row?.auction_time) update.auction_time = salePatch.auctionTime;
    }

    if (Object.keys(update).length > 0) {
      await supabase.from("properties").update(update).eq("id", propertyId);
    }
  }

  for (const patch of patches) {
    const { data: existingRow } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId)
      .eq("item_key", patch.itemKey)
      .maybeSingle();
    const existing = existingRow as PropertyItem | null;

    // The auto-complete exceptions in this file — a2 (consumer guide) and a1
    // (vendor identity). Each fires only when the model gave an explicit
    // positive confirmation AND a date (both required — a confirmation with
    // no date falls through to the normal pre-fill path so the agent supplies
    // the date), and the item is still untouched ("open"). That last
    // condition matters: this must never downgrade a "flagged" item or
    // silently redo something a human already set — it only fills in a
    // genuinely blank item.
    //
    // a1 added 17 Aug 2026 (Adam): where the agency agreement itself carries
    // the VOI confirmation, there is nothing for the agent to re-key. Note
    // the deliberate asymmetry with a2 below — a2 has a "not found" path
    // because the guide acknowledgement BELONGS in the agreement, so its
    // absence is meaningful. Identity verification normally lives in a
    // separate audit trail (FLK), so an agreement silent on it is the normal
    // case and flagging that would cry wolf on nearly every listing.
    //
    // Never fires on a wrong-document patch. Belt and braces — a mismatch
    // patch carries no eventDate so it could not reach here anyway — but
    // auto-marking a compliance item "done" is the one thing in this file
    // that writes a decision rather than offering one, so it gets an explicit
    // guard rather than relying on a property of some other object.
    const autoComplete =
      !patch.wrongDocument &&
      !!patch.eventDate &&
      (existing?.status ?? "open") === "open" &&
      ((patch.itemKey === "a2" && patch.consumerGuideProvided === true) ||
        (patch.itemKey === "a1" && patch.identityVerified === true));

    await supabase.from("property_items").upsert(
      {
        agency_id: profile.agency_id,
        property_id: propertyId,
        item_key: patch.itemKey,
        status: autoComplete ? "done" : existing?.status ?? "open",
        data: {
          ...(existing?.data ?? {}),
          // See the note above getItem: on findings-only items the AI owns
          // this text, so a fresh reading replaces it. On items with a real
          // note box the agent owns it, and extraction stays in aiDraft where
          // it is offered rather than imposed.
          // On a findings item the AI owns this text — there is no note box
          // for the agent to type in — so a fresh reading REPLACES it, and
          // replacing it with nothing is a real answer.
          //
          // This used to be conditional on patch.note existing, which left a
          // hole the staleFindings sweep below does not cover: an item that
          // gets a patch carrying only structured data (b1's prescribedDocs,
          // say) is "spoken for", so the sweep skips it, but the upsert wrote
          // no note either — and last run's text survived underneath fresh
          // findings. That is how b1 came to show "this document is a
          // PropTrack property report" above a list of nine contract
          // documents it had just found.
          ...(getItem(patch.itemKey)?.showFindings ? { note: patch.note ?? "" } : {}),
          aiDraft: {
            note: patch.note,
            espLow: patch.espLow,
            espHigh: patch.espHigh,
            eventDate: patch.eventDate,
            consumerGuideProvided: patch.consumerGuideProvided,
            identityVerified: patch.identityVerified,
            // a7. Offered as the default answer on the card, never saved on
            // the agent's behalf and never auto-completing the item — unlike
            // a1/a2 above. The asymmetry is deliberate: a1 and a2 are facts
            // ABOUT the agreement (was the guide given, was ID sighted) that
            // the agreement itself evidences. a7 is the agent's own diligence
            // — did you ask the vendor — and answering "none disclosed" on
            // their behalf writes a compliance record they never made. It
            // also drives e2, the disclosure to purchasers, so a wrong "no"
            // silently removes an obligation later in the file.
            materialFactDisclosed: patch.materialFactDisclosed,
            // b1 only. Filtered against the current rules list so a stale key
            // from an older ruleset version can never render as a mystery row.
            prescribedDocs: patch.prescribedDocs?.filter((d) =>
              PRESCRIBED_DOC_KEYS.includes(d.key),
            ),
            notAContract: patch.notAContract,
            wrongDocument: patch.wrongDocument,
            // Flags the ItemCard banner to explain *why* this is already
            // done rather than just pre-filled, and that it was AI-set, not
            // agent-confirmed — reversible any time via the existing Reopen
            // button, same as any other "done" item.
            autoCompleted: autoComplete || undefined,
            generatedAt: new Date().toISOString(),
          },
        },
        event_date: autoComplete ? (patch.eventDate as string) : existing?.event_date ?? null,
        completed_by: existing?.completed_by ?? null,
        evidence_path: existing?.evidence_path ?? null,
      },
      { onConflict: "property_id,item_key" },
    );
  }

  // ── Clear findings this run did not reproduce ──────────────────────────
  //
  // ADDED 20 Aug 2026, immediately after the SOURCE_TARGETS change, because
  // Adam re-read 24/1 Citrus Ave and the a3 card still showed the previous
  // run's finding — "This document is a Contract for the Sale and Land" —
  // even though the fresh read had produced no note for a3 at all.
  //
  // On a showFindings item the AI owns the text: there is no note box for the
  // agent to type in, so whatever is there came from an extraction. When a
  // later read of the SAME document says nothing about that item, the honest
  // state is silence, not the previous answer. Leaving it means a finding
  // outlives the reading that produced it — and worse, survives the fix that
  // was supposed to remove it, which is exactly how it looked to Adam.
  //
  // Only items whose source document was actually read this run are cleared.
  // A run scoped to one attachment (onlyItemKey) says nothing about the items
  // belonging to the other two documents, so it must not wipe them.
  const readSources = withEvidence.map((i) => i.item_key as SourceKey);
  const covered = new Set(readSources.flatMap((s) => Array.from(SOURCE_TARGETS[s])));
  const spokenFor = new Set(patches.map((p) => p.itemKey));
  const staleFindings = Array.from(covered).filter(
    (key) => !spokenFor.has(key) && getItem(key)?.showFindings,
  );

  for (const itemKey of staleFindings) {
    const { data: staleRow } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId)
      .eq("item_key", itemKey)
      .maybeSingle();
    const stale = staleRow as PropertyItem | null;
    const staleData = (stale?.data ?? {}) as Record<string, unknown>;
    // Nothing there to clear.
    if (!staleData.note && !staleData.aiDraft) continue;

    await supabase
      .from("property_items")
      .update({
        data: { ...staleData, note: "", aiDraft: { generatedAt: new Date().toISOString() } },
      })
      .eq("property_id", propertyId)
      .eq("item_key", itemKey);
  }

  // The agreement was read and produced nothing for a2, meaning the vendor's
  // acknowledgement of the approved guide is not in it. That is a real, useful
  // conclusion and distinct from nobody having looked yet, so it is recorded
  // rather than left as silence — otherwise the card looks identical whether
  // the document was checked or not (Adam, 14 Aug 2026). Never touches an item
  // already marked done: a human decision outranks this.
  //
  // The wrongDocument check is load-bearing: if the file in the agency-
  // agreement slot turned out to be a contract, we did NOT read an agency
  // agreement, and telling the agent we looked for the acknowledgement and
  // couldn't find it would be a finding about a document nobody opened.
  const agreementSlotHeldWrongDocument = patches.some((p) => p.itemKey === "a3" && p.wrongDocument);

  // Same idea for a1 (vendor identity), added 20 Aug 2026 (Adam): "in the
  // event that VOI is not included in a sales agreement, we should ask for it
  // to be uploaded in the Vendor identity verified window."
  //
  // Until now a1 simply stayed blank when nothing was found, which looks
  // identical to nobody having run the extraction. The agent had no way to
  // tell "the agreement carries no verification record, go and attach one"
  // from "this hasn't been looked at yet". a1 now carries the same
  // we-looked-and-it-isn't-there state that a2 has had since 14 Aug.
  if (readAgencyAgreement && !agreementSlotHeldWrongDocument && !patches.some((p) => p.itemKey === "a1")) {
    const { data: a1Row } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId)
      .eq("item_key", "a1")
      .maybeSingle();
    const a1 = a1Row as PropertyItem | null;

    if ((a1?.status ?? "open") !== "done") {
      await supabase.from("property_items").upsert(
        {
          agency_id: profile.agency_id,
          property_id: propertyId,
          item_key: "a1",
          status: a1?.status ?? "open",
          data: {
            ...(a1?.data ?? {}),
            aiDraft: {
              ...((a1?.data as { aiDraft?: Record<string, unknown> } | undefined)?.aiDraft ?? {}),
              voiNotFound: true,
              generatedAt: new Date().toISOString(),
            },
          },
          event_date: a1?.event_date ?? null,
          completed_by: a1?.completed_by ?? null,
          evidence_path: a1?.evidence_path ?? null,
        },
        { onConflict: "property_id,item_key" },
      );
    }
  }

  if (readAgencyAgreement && !agreementSlotHeldWrongDocument && !patches.some((p) => p.itemKey === "a2")) {
    const { data: a2Row } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId)
      .eq("item_key", "a2")
      .maybeSingle();
    const a2 = a2Row as PropertyItem | null;

    if ((a2?.status ?? "open") !== "done") {
      await supabase.from("property_items").upsert(
        {
          agency_id: profile.agency_id,
          property_id: propertyId,
          item_key: "a2",
          status: a2?.status ?? "open",
          data: {
            ...(a2?.data ?? {}),
            aiDraft: {
              ...((a2?.data as { aiDraft?: Record<string, unknown> } | undefined)?.aiDraft ?? {}),
              guideNotFound: true,
              generatedAt: new Date().toISOString(),
            },
          },
          event_date: a2?.event_date ?? null,
          completed_by: a2?.completed_by ?? null,
          evidence_path: a2?.evidence_path ?? null,
        },
        { onConflict: "property_id,item_key" },
      );
    }
  }

  revalidatePath(`/dashboard/${propertyId}`);

  // Say it at the top of the page, not only on the card. A file in the wrong
  // slot means nothing was read from it at all, and an agent who came here
  // expecting their items to fill in needs to know why they didn't.
  const mismatches = patches.filter((p) => p.wrongDocument);
  if (mismatches.length > 0) {
    const detail = mismatches
      .map(
        (p) =>
          `the file uploaded as the ${SOURCE_LABELS[p.itemKey] ?? p.itemKey} looks like ${p.wrongDocument!.actual}`,
      )
      .join("; ");
    return {
      error: `Nothing was recorded from ${mismatches.length === 1 ? "one document" : "some documents"} — ${detail}. Replace the file on that item and it'll read again.`,
    };
  }

  if (patches.length === 0) {
    return {
      error:
        failures.length > 0
          ? `Couldn't extract anything: ${failures.join("; ")}`
          : "Didn't find any clearly-stated facts in the attached documents to pre-fill.",
    };
  }

  return failures.length > 0 ? { error: `Extracted what it could, but hit an issue: ${failures.join("; ")}` } : ok;
}
