import { allItemsInRuleset } from "@/lib/rules/nsw-sales";
import type { PropertyStage } from "@/lib/types";

// The RealComply annexure to an agency's Supervision Guidelines, the client
// version (brief, 14 Oct 2026: "Use the 6-page PDF ... as the annexure text
// (full version, client wording)").
//
// WORDING IS FIXED. Every adoption records SG_ANNEXURE_VERSION, and the signed
// copy is the text below as it stood that day. Change a word and the version
// must change with it, or an adoption would point at text it never saw.
//
// Client version, so: no "Draft for review", no reviewer line, and no version
// line under the title (brief). The version is still printed with the
// adoption, where it records what was adopted.
//
// SCHEDULE 1 IS LIVE. It is built from the checklist (src/lib/rules/
// nsw-sales.ts) every time the annexure is shown or printed, as clause 4.2
// says. A retired card is no longer in the checklist, so it cannot appear.
// Em dashes in a card's provision are written as colons, as the approved PDF
// does: no em dashes in what a customer reads.

export const SG_ANNEXURE_VERSION = "1.4";

export const SG_ANNEXURE_TITLE = "Annexure to the Supervision Guidelines";
export const SG_ANNEXURE_SUBTITLE = "Use of a compliance platform within the agency's supervision system";

/** The yellow box under the title (brief, word for word). */
export const SG_ANNEXURE_NOTICE =
  "Provided by RealComply for the licensee in charge to consider and adopt. Not legal advice. The licensee should be satisfied it suits their agency and may seek their own advice before adopting it.";

/** The footer on every page of the PDF. */
export const SG_ANNEXURE_FOOTER = "RealComply Pty Ltd · ABN 61 700 934 792 · Not legal advice";

export type AnnexureClause = { num: string; text: string };
export type AnnexureSection = { num: string; heading: string; clauses: AnnexureClause[] };

export const SG_ANNEXURE_SECTIONS_BEFORE_SCHEDULES: AnnexureSection[] = [
  {
    num: "1",
    heading: "Purpose and status",
    clauses: [
      {
        num: "1.1",
        text: "This annexure forms part of the agency's Supervision Guidelines. It is adopted by the licensee in charge and takes effect on the date recorded above.",
      },
      {
        num: "1.2",
        text: 'In this annexure, "the platform" means RealComply, the compliance platform the agency has adopted, including where it is supplied under a franchise or partner brand.',
      },
      {
        num: "1.3",
        text: "This annexure records the method by which the agency makes, keeps and produces certain records. It does not change what the agency is required to do. Every obligation under the Property and Stock Agents Act 2002 (NSW), the Property and Stock Agents Regulation 2022 (NSW) and any other applicable law continues to apply in full and unaltered.",
      },
      {
        num: "1.4",
        text: "Where anything in this annexure conflicts with the Supervision Guidelines, the Supervision Guidelines prevail. Where anything in this annexure conflicts with a requirement of law, the law prevails.",
      },
      {
        num: "1.5",
        text: "The licensee in charge reviews this annexure at least annually, and whenever the agency's obligations or the platform's capabilities change materially.",
      },
      {
        num: "1.6",
        text: "Where the platform is used by some of the agency's agents and not others, including where an individual agent subscribes to it personally, this annexure applies to the records made in the platform by those agents. Records made by other agents continue to be made and kept by the agency's other methods, and nothing in this annexure changes them.",
      },
      {
        num: "1.7",
        text: "Where the licensee in charge does not hold a login to the platform, any approval the licensee gives under clause 3.5 is given through a link sent to the licensee personally at the email address the agency has recorded for the licensee in charge. A listing's file is not finalised in the platform until the licensee in charge has signed it off in this way.",
      },
    ],
  },
  {
    num: "2",
    heading: "What the platform is, and is not",
    clauses: [
      {
        num: "2.1",
        text: "The platform is a tool the agency has adopted within its supervision system. It prompts for records the agency is required to make, holds those records, and flags matters for a person's attention.",
      },
      { num: "2.2", text: "The platform does not provide legal advice." },
      {
        num: "2.3",
        text: "The platform does not certify, determine or guarantee that the agency, a listing or any person is compliant. A file shown as complete in the platform means the records the agency configured have been recorded, nothing more.",
      },
      {
        num: "2.4",
        text: "The platform is not the agency's compliance officer and does not supervise the business. Supervision under section 32 of the Act is performed by the licensee in charge.",
      },
      {
        num: "2.5",
        text: "Where the platform proposes content, including content drawn from an uploaded document and any text it drafts, that content is a suggestion until a person reads it and records it. The person who records it is responsible for it.",
      },
      {
        num: "2.6",
        text: "Where the platform expresses an opinion or a conclusion about a matter requiring professional judgement, it does not do so on the agency's behalf. Judgements of that kind, including the estimated selling price and the reasoning for it, are made and recorded by the agent or the licensee in their own words.",
      },
    ],
  },
  {
    num: "3",
    heading: "How the agency uses the platform",
    clauses: [
      {
        num: "3.1",
        text: "The record is the evidence, not the form. Where the agency holds the underlying record required by law, it does not additionally complete a form whose only purpose is to restate that the record exists.",
      },
      {
        num: "3.2",
        text: "A digital trail is a record. Where a document is prepared or served through a system that keeps an audit trail, that trail evidences preparation and service without a separate note.",
      },
      {
        num: "3.3",
        text: "A record already made and kept in another system the agency uses is not made a second time. The file records that the record is held elsewhere and identifies where, specifically enough that it can be found and produced by a person other than the one who made it. Where the record can be exported or copied, a copy is also attached. The agency remains responsible for producing and retaining that record wherever it is held.",
      },
      {
        num: "3.4",
        text: "Each person uses the platform under their own individual login. Records identify the person who made or completed them and when. Shared logins are not permitted.",
      },
      {
        num: "3.5",
        text: "Where a record requires the approval of the licensee in charge, the licensee gives that approval personally. The platform records the name of the person approving and the date and time. Where the record approved is an uploaded document, a page recording the same details is added to a copy of that document and the document as uploaded is retained unaltered alongside it.",
      },
      {
        num: "3.6",
        text: "Where a correction is made, the corrected record is the record. Where a document that has been signed off is replaced, the earlier sign-off is cleared and the document is signed off again, the file records what was replaced and by whom, and the superseded document is retained.",
      },
      {
        num: "3.7",
        text: "The agency reviews outstanding and flagged matters as part of its ordinary supervision, and records any non-compliance and the corrective action taken in its breaches and corrective actions register.",
      },
    ],
  },
  {
    num: "4",
    heading: "Records kept in the platform",
    clauses: [
      {
        num: "4.1",
        text: "Schedule 1 lists the records kept for each listing, grouped by the stage of the transaction, with the provision each relates to. Schedule 2 lists the registers kept at agency level.",
      },
      {
        num: "4.2",
        text: "The schedules describe the platform's ruleset as at the version recorded on this annexure. The ruleset is updated as the law changes; the schedules are regenerated from it, and this annexure is reissued when they change materially.",
      },
      {
        num: "4.3",
        text: "A record listed in the schedules may be held elsewhere in accordance with clause 3.3. Its inclusion here does not require it to be held in the platform.",
      },
      {
        num: "4.4",
        text: "A finalised record can be generated for any listing, showing the state of that file and the version of the ruleset applied to it.",
      },
    ],
  },
];

export const SG_ANNEXURE_SCHEDULE_1_HEADING = "Schedule 1: records kept for each listing";
export const SG_ANNEXURE_SCHEDULE_1_LINE =
  "Generated from the platform's checklist. The checklist is updated as the law changes, and this schedule with it.";
export const SG_ANNEXURE_SCHEDULE_2_HEADING = "Schedule 2: registers kept at agency level";

export const SG_ANNEXURE_SCHEDULE_2: Array<{ register: string; holds: string }> = [
  {
    register: "Licences and certificates of registration",
    holds: "Held for each person engaged in the business, with expiry dates and reminders.",
  },
  { register: "Professional indemnity insurance", holds: "Current policy and expiry." },
  { register: "Gifts and benefits", holds: "Gifts and benefits received, and how each was dealt with." },
  { register: "Complaints", holds: "Complaints received, and their resolution." },
  { register: "Breaches and corrective actions", holds: "Non-compliance identified, and the action taken." },
  { register: "Annual training plan and training log", holds: "The plan for the year, and training actually completed." },
  { register: "Continuing professional development", holds: "CPD completed, per person, per CPD year." },
  {
    register: "Trust account reconciliations",
    holds:
      "The monthly reconciliation and trial balance for each trust account, filed against the month they cover, with the licensee in charge's review recorded against each.",
  },
  { register: "Trust account annual audit", holds: "The audit period, the auditor, and the lodgement." },
  {
    register: "Document sign-offs",
    holds:
      "Documents published for sign-off, including versions of these Supervision Guidelines, with the signature of each person required to sign.",
  },
  { register: "Staff register", holds: "The people engaged in the business and their access." },
];

export const SG_ANNEXURE_SECTIONS_AFTER_SCHEDULES: AnnexureSection[] = [
  {
    num: "5",
    heading: "Accountability and limitations",
    clauses: [
      {
        num: "5.1",
        text: "The licensee in charge remains accountable for the agency's compliance. Adopting this annexure does not transfer that accountability to the platform or its supplier, and could not.",
      },
      {
        num: "5.2",
        text: "Each agent is responsible for the records they make, for the accuracy of what they record, and for reading anything the platform proposes before recording it.",
      },
      {
        num: "5.3",
        text: "A record is only as good as what was put into it. The platform cannot know a fact the agency has not recorded, and cannot detect that a recorded fact is wrong.",
      },
      {
        num: "5.4",
        text: "The platform is one safeguard among several. It is not a substitute for the agency's own knowledge of its obligations, for training, or for advice from the agency's compliance adviser or lawyer.",
      },
      {
        num: "5.5",
        text: "The agency's obligation to retain its records for the period required by law is unaffected by the platform, including if the agency ceases to use it. The licensee in charge is responsible for obtaining a copy of the agency's records before any such cessation takes effect.",
      },
      {
        num: "5.6",
        text: "Records kept in the platform may be stored outside the State. The agency's obligations in respect of those records are unaffected and the records remain within the agency's possession, custody or control.",
      },
      {
        num: "5.7",
        text: "Before adopting the platform, and on each review, the agency satisfies itself as to the platform's privacy and information security position.",
      },
      {
        num: "5.8",
        text: "Adopting this annexure does not make the agency a party to any agreement with the supplier of the platform, and creates no obligation between the agency and the supplier. Where the platform is used by an agent who subscribes personally, the agreement for the platform is between that agent and the supplier.",
      },
    ],
  },
];

export const SG_ANNEXURE_ADOPTION = {
  heading: "6. Adoption by the licensee in charge",
  declaration:
    "I am the licensee in charge of the agency named above. I have read this annexure. I adopt it as part of the agency's Supervision Guidelines with effect from the date recorded above, and I confirm that the agency's compliance, and the supervision of its business, remain my responsibility.",
  electronic:
    "This adoption may be signed on paper or recorded electronically through the platform. An electronic adoption records the name typed by the licensee in charge, the licence number given, the email address to which the adoption request was sent, and the date and time, and is kept with the version of this annexure that was adopted.",
} as const;

export const SG_ANNEXURE_AGENT_STATEMENT = {
  heading: "7. Agent operating statement",
  note: "Optional. Completed by each agent using the platform.",
  statement:
    "I have read this annexure. I understand that the platform supports my work and does not do it for me, that I am responsible for the records I make and for reading anything the platform proposes before I record it, and that using the platform means meeting the agency's standard for these records, not a lighter one.",
  fields: ["Name", "Certificate or licence number", "Signature", "Date"],
} as const;

/**
 * What the licensee ticks on the signing page (brief, word for word). The
 * adoption section of the annexure itself keeps its own wording above.
 */
export const SG_ANNEXURE_TICK =
  "I am the licensee in charge of the agency named above. I have read this annexure, adopt it as part of the agency's Supervision Guidelines from the date above, and confirm the agency's compliance and supervision remain my responsibility.";

// ── Schedule 1, from the checklist ──────────────────────────────────────────

/**
 * The stage headings of the approved PDF. The app calls stages 2 to 4 "On
 * market", "Campaign" and "Sold"; the annexure names what happens in them.
 */
const SCHEDULE_STAGE_HEADINGS: Record<PropertyStage, string> = {
  0: "Listing set-up",
  1: "Pre-market",
  2: "Campaign",
  3: "Offers and negotiation",
  4: "Exchange",
  5: "Settled",
};

const noEmDash = (s: string): string => s.replace(/\s+[—–]\s+/g, ": ").replace(/[—–]/g, "-").trim();

export type ScheduleOneGroup = { heading: string; rows: Array<{ record: string; provision: string }> };

/**
 * Schedule 1 as it stands in the checklist today: every card, grouped by
 * stage, in the checklist's own order. Cards shown only on some listings (a
 * pool, a tenant, an auction) are included, because the schedule describes
 * the platform, not one file.
 */
export function scheduleOne(): ScheduleOneGroup[] {
  const items = allItemsInRuleset();
  const stages = [0, 1, 2, 3, 4, 5] as PropertyStage[];
  return stages
    .map((stage) => ({
      heading: SCHEDULE_STAGE_HEADINGS[stage],
      rows: items
        .filter((i) => i.stage === stage)
        .map((i) => ({ record: noEmDash(i.label), provision: noEmDash(i.legalBasis ?? "") })),
    }))
    .filter((g) => g.rows.length > 0);
}

// ── The details at the top ──────────────────────────────────────────────────

/** A date as the annexure prints it: "14 October 2026", in Sydney. */
export function annexureDate(at: Date | string = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

/** The first word of a typed name, for "Thank you, Sam." Blank when there is none. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}
