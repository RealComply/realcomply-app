"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { downloadedFileProblem } from "@/lib/storage/file-check";
import { reportReadFailed, reportReadFrom, type ReportRead } from "@/lib/documents/report-read";
import { READ_FAILED_JUST_NOW, TOO_LARGE_TO_READ, mergeReads } from "@/lib/documents/reader-parts";
import {
  FileCantBeRead,
  askParts,
  failedReadSentence,
  prepareRead,
  readFailure,
  readFailureWhy,
  type ReadFailureWhy,
} from "@/lib/documents/read-core";
import { noteRead, type ReaderName } from "@/lib/documents/read-record";
import {
  SOURCE_ITEM_KEYS,
  SOURCE_LABELS,
  SOURCE_TARGETS,
  readListingDocument,
  type DraftPatch,
  type SourceKey,
} from "@/lib/documents/listing-reader";
import {
  COVERING_LETTER_KEY,
  COVERING_LETTER_NO_DATE,
  COVERING_LETTER_SIGNED_OFF,
  COVERING_LETTER_UNREADABLE,
  afterLetterRead,
  afterLetterReadFailed,
  coveringLetterDate,
} from "@/lib/documents/covering-letter";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { getItem } from "@/lib/rules/nsw-sales";
import {
  PRESCRIBED_DOC_KEYS,
  prescribedDocumentsFor,
  type PrescribedDoc,
} from "@/lib/rules/nsw-prescribed-documents";
import type { PropertyItem } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

// The listing documents' reader (sources, the answer it's asked for, the
// prompts) lives in lib/documents/listing-reader.ts since 1 Nov 2026.


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
      participantName: {
        type: "string",
        description:
          "The name of the person the record or statement was issued to, exactly as printed. Only if stated. " +
          "Never the trainer's or the provider's name.",
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
  /** Who it was issued to, as printed (15 Oct 2026: checked against the person). */
  participantName?: string;
};

/** Reads an uploaded CPD certificate. Never writes — the agent confirms. */
export async function extractCpdCertificate(
  path: string,
  fileName: string,
): Promise<{ error: string | null; fields?: CpdCertificateFields }> {
  const { supabase, profile } = await requireAuthContext();

  // Said on the CPD card since 1 Nov 2026 (it was never shown before), so in
  // the card's plain words.
  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Reading certificates isn't set up yet, so the details need typing in for now." };
  }

  // Every read recorded, and a failed one alerted (1 Nov 2026; lib/documents/read-record).
  const where = { reader: "cpd_certificate", card: "CPD register", fileName, agencyId: profile.agency_id } as const;
  const failed = (why: ReadFailureWhy, error?: unknown) => noteRead(supabase, { ...where, outcome: "failed", why, error });

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    await failed("file");
    return { error: "Couldn't download the uploaded file." };
  }
  const unreadable = await downloadedFileProblem(blob, fileName);
  if (unreadable) {
    await failed("file");
    return { error: unreadable };
  }

  const prepared = await prepareRead(blob, fileName);
  if (!prepared.ok) {
    await failed(prepared.problem === "too_large" ? "too_large" : "unsupported");
    return prepared.problem === "too_large"
      ? { error: TOO_LARGE_TO_READ, fields: {} }
      : { error: `That file type can't be read yet (${prepared.contentType}), so the details need typing in.` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Caught, as the licence read is (check, 10 Oct 2026). An overloaded API, a
  // timeout or a photo too big to send threw straight through
  // addCpdFromCertificate, so no entry was made and the card sat on "Reading
  // certificate…" until a reload. A failed read is a read of nothing: the
  // entry is still made from the file, and the card says the read failed and
  // asks for the rest (1 Nov 2026: it said nothing before, so a certificate
  // whose answer was cut off looked like one that states nothing).
  try {
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 1024,
      system:
        "You are reading a continuing professional development record of completion, or a statement of " +
        "attainment, for a NSW licensed real estate agent's CPD register (RealComply). Record only what the " +
        "document explicitly and literally states. Never infer, estimate or convert — if it gives a start and " +
        "end time but no duration, do not calculate hours. If it does not name a provider, do not guess one from " +
        "a logo or a filename. You have been shown the complete content available to you; do not assume further " +
        "pages exist. You must call record_cpd_certificate exactly once, but calling it with few fields set is a " +
        "completely normal and successful outcome — the agent reviews and completes it, you do not.",
      text: `This was uploaded as "${fileName}" for a CPD register. Call record_cpd_certificate with whatever it explicitly states.`,
      tool: CPD_CERTIFICATE_TOOL,
    });
    await noteRead(supabase, { ...where, outcome: "read" });
    return { error: null, fields: mergeReads(answers) as CpdCertificateFields };
  } catch (e) {
    const why = readFailureWhy(e);
    await failed(why, e);
    return {
      error: failedReadSentence(
        why,
        "the certificate",
        "It's saved on the CPD record above: add its details there.",
        "Couldn't read the certificate just now. It's saved on the CPD record above: add its details there.",
      ),
      fields: {},
    };
  }
}

// ── Licences and certificates of registration ──────────────────────────────
//
// Adam's rule, Oct 2026: upload, don't type. A NSW licence or certificate of
// registration states everything the register keeps: whose it is, what it
// is, its number and when it expires. So the upload reads them, and typing is
// only for correcting a wrong read.
//
// Same shape as every other read in this file: one tool, forced, documentIs
// decided FIRST so a wrong file says so instead of yielding a plausible-
// looking licence. The model writes nothing. lib/licence-read.ts validates
// what comes back and decides what is saved, including refusing to save at
// all when the name on the document is someone else's.
const LICENCE_TOOL: Anthropic.Tool = {
  name: "record_licence",
  description:
    "Record the details printed on a NSW real estate licence, certificate of registration or corporation " +
    "licence. Omit any field you cannot read with confidence and list it in unreadableFields instead. Never " +
    "guess, and never work a date out from another date.",
  input_schema: {
    type: "object",
    properties: {
      documentIs: {
        type: "string",
        enum: ["licence", "certificate_of_registration", "corporation_licence", "other"],
        description:
          "ALWAYS set this first, from what the document actually is, not from the filename. " +
          "'licence' — an individual's Class 1 or Class 2 licence. 'certificate_of_registration' — an " +
          "assistant agent's certificate of registration. 'corporation_licence' — a licence held by a company. " +
          "'other' — anything else (an invoice, a CPD certificate, an ID card, a blank page).",
      },
      holderName: {
        type: "string",
        description: "The licence holder's name exactly as printed (a person, or for a corporation licence the company).",
      },
      licenceType: {
        type: "string",
        enum: ["class_1", "class_2", "certificate_of_registration"],
        description:
          "Only if the document states it: 'class_1' for a Class 1 licence, 'class_2' for a Class 2 licence, " +
          "'certificate_of_registration' for a certificate of registration.",
      },
      licenceNumber: {
        type: "string",
        description: "The licence or certificate number exactly as printed, with no spaces added or removed.",
      },
      expiryDate: {
        type: "string",
        description:
          "The expiry date printed on the document, as YYYY-MM-DD. Only a date labelled as the expiry (or 'valid " +
          "until'). Never an issue date, and never an issue date plus a term.",
      },
      unreadableFields: {
        type: "array",
        items: { type: "string", enum: ["holderName", "licenceType", "licenceNumber", "expiryDate"] },
        description:
          "Every field that appears on the document but cannot be read with confidence: blurred, cut off, " +
          "covered by glare, or ambiguous (for example a date that could be read two ways).",
      },
    },
    required: ["documentIs"],
  },
};

/**
 * Reads an uploaded licence. Never writes; returns the raw tool input for
 * lib/licence-read.ts to validate. An error means nothing was read at all.
 */
export async function extractLicenceDocument(
  path: string,
  fileName: string,
): Promise<{ error: string | null; raw?: unknown }> {
  const { supabase, profile } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Reading documents isn't set up yet, so the details need typing in for now." };
  }

  // Every read recorded, and a failed one alerted (1 Nov 2026; lib/documents/read-record).
  const where = { reader: "licence", card: "Licence register", fileName, agencyId: profile.agency_id } as const;
  const failed = (why: ReadFailureWhy, error?: unknown) => noteRead(supabase, { ...where, outcome: "failed", why, error });

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    await failed("file");
    return { error: "Couldn't open the uploaded file to read it." };
  }
  const unreadable = await downloadedFileProblem(blob, fileName);
  if (unreadable) {
    await failed("file");
    return { error: unreadable };
  }

  const prepared = await prepareRead(blob, fileName);
  if (!prepared.ok) {
    await failed(prepared.problem === "too_large" ? "too_large" : "unsupported");
    return prepared.problem === "too_large"
      ? { error: TOO_LARGE_TO_READ }
      : { error: `That file type can't be read (${prepared.contentType}). Upload a PDF or a photo instead.` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 1024,
      system:
        "You are reading a document uploaded to the licence register of a NSW real estate agency (RealComply). " +
        "Record only what the document explicitly and literally states. A photo may be skewed, partly covered or " +
        "blurred: if any character of a number or date is uncertain, leave that field out and list it in " +
        "unreadableFields. A wrong expiry date is worse than none, because reminders are scheduled from it. " +
        "You must call record_licence exactly once; leaving fields out is a normal, successful outcome.",
      text:
        `This was uploaded as "${fileName}". FIRST set documentIs from what the document actually is. ` +
        "THEN record the holder name, licence type, number and expiry date as printed.",
      tool: LICENCE_TOOL,
    });
    await noteRead(supabase, { ...where, outcome: "read" });
    return { error: null, raw: mergeReads(answers) };
  } catch (e) {
    // Said on the card (1 Nov 2026): an answer cut off at the limit used to
    // pass for a licence that states nothing.
    const why = readFailureWhy(e);
    await failed(why, e);
    return {
      error: failedReadSentence(
        why,
        "the document",
        "Type the details in, or upload it again.",
        "Couldn't read the document just now, so the details need typing in.",
      ),
    };
  }
}

// ── Insurance certificates of currency and policy schedules ────────────────
//
// Trent (Lloyd Property, 15 Oct 2026): attach the certificate to the
// Insurance register, so it can be shown when Fair Trading visits. Same
// shape as the licence read above: documentIs decided FIRST, so an invoice
// says so instead of yielding a plausible-looking policy, and the cover is
// read so a workers compensation certificate can't land on professional
// indemnity. The model writes nothing; lib/insurance-read.ts validates what
// comes back and decides what is saved.
const INSURANCE_TOOL: Anthropic.Tool = {
  name: "record_insurance_certificate",
  description:
    "Record the details printed on an insurance certificate of currency or policy schedule. Omit any field " +
    "you cannot read with confidence and list it in unreadableFields instead. Never guess, and never work a " +
    "date out from another date.",
  input_schema: {
    type: "object",
    properties: {
      documentIs: {
        type: "string",
        enum: ["certificate_of_currency", "policy_schedule", "other"],
        description:
          "ALWAYS set this first, from what the document actually is, not from the filename. " +
          "'certificate_of_currency': a certificate confirming a policy is in force. 'policy_schedule': the " +
          "schedule of a policy, listing the insured, insurer, cover and period. 'other': anything else (an " +
          "invoice or renewal notice on its own, a quote, a licence, a blank page).",
      },
      covers: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "professional_indemnity",
            "cyber",
            "workers_compensation",
            "public_liability",
            "office_contents",
            "motor_vehicle",
            "other",
          ],
        },
        description:
          "Every kind of cover the document says the policy provides. 'workers_compensation' includes icare " +
          "workers insurance. 'office_contents' is contents, property or a business package covering the " +
          "office's own premises and things (list 'public_liability' too if the package includes it). " +
          "'motor_vehicle' is cover for a vehicle, comprehensive, third party or CTP. Leave empty if the " +
          "document doesn't say.",
      },
      insurer: {
        type: "string",
        description: "The insurer (the company providing the cover, not the broker or the insured), as printed.",
      },
      policyNumber: {
        type: "string",
        description: "The policy number exactly as printed, with no spaces added or removed.",
      },
      expiryDate: {
        type: "string",
        description:
          "The date the cover ends, as YYYY-MM-DD: the end of the period of insurance, or a date labelled " +
          "expiry or 'to'. Australian documents write dates day first (30/06/2027 is 30 June 2027). Never a " +
          "start date or an issue date, and never a start date plus a term.",
      },
      unreadableFields: {
        type: "array",
        items: { type: "string", enum: ["insurer", "policyNumber", "expiryDate"] },
        description:
          "Every field that appears on the document but cannot be read with confidence: blurred, cut off, " +
          "covered by glare, or ambiguous.",
      },
    },
    required: ["documentIs"],
  },
};

/**
 * Reads an uploaded insurance certificate. Never writes; returns the raw tool
 * input for lib/insurance-read.ts to validate. An error means nothing was
 * read at all.
 */
export async function extractInsuranceCertificate(
  path: string,
  fileName: string,
): Promise<{ error: string | null; raw?: unknown }> {
  const { supabase, profile } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "Reading documents isn't set up yet, so the details need typing in for now." };
  }

  // Every read recorded, and a failed one alerted (1 Nov 2026; lib/documents/read-record).
  const where = { reader: "insurance_certificate", card: "Insurance register", fileName, agencyId: profile.agency_id } as const;
  const failed = (why: ReadFailureWhy, error?: unknown) => noteRead(supabase, { ...where, outcome: "failed", why, error });

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    await failed("file");
    return { error: "Couldn't open the uploaded file to read it." };
  }
  const unreadable = await downloadedFileProblem(blob, fileName);
  if (unreadable) {
    await failed("file");
    return { error: unreadable };
  }

  const prepared = await prepareRead(blob, fileName);
  if (!prepared.ok) {
    await failed(prepared.problem === "too_large" ? "too_large" : "unsupported");
    return prepared.problem === "too_large"
      ? { error: TOO_LARGE_TO_READ }
      : { error: `That file type can't be read (${prepared.contentType}). Upload a PDF or a photo instead.` };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 1024,
      system:
        "You are reading a document uploaded to the insurance register of a NSW real estate agency (RealComply). " +
        "Record only what the document explicitly and literally states. A photo may be skewed, partly covered or " +
        "blurred: if any character of a number or date is uncertain, leave that field out and list it in " +
        "unreadableFields. A wrong expiry date is worse than none, because the register shows the policy as " +
        "current from it. You must call record_insurance_certificate exactly once; leaving fields out is a " +
        "normal, successful outcome.",
      text:
        `This was uploaded as "${fileName}". FIRST set documentIs from what the document actually is. ` +
        "THEN record the cover, the insurer, the policy number and the expiry date as printed.",
      tool: INSURANCE_TOOL,
    });
    await noteRead(supabase, { ...where, outcome: "read" });
    return { error: null, raw: mergeReads(answers) };
  } catch (e) {
    const why = readFailureWhy(e);
    await failed(why, e);
    return {
      error: failedReadSentence(
        why,
        "the certificate",
        "Type the details in, or upload it again.",
        "Couldn't read the certificate just now, so the details need typing in.",
      ),
    };
  }
}

// ── The revised-ESP notice ─────────────────────────────────────────────────
//
// Adam, 22 Aug 2026: "in the campaign stage, [the last question] should ask if
// the ESP was revised. If it is, they have to upload whichever document they
// used to provide the vendor the revision of the ESP. The AI then reads it,
// records it, and that's how it knows what price it needs to be looking for
// when reviewing the agent's website."
//
// That is the right shape, and it is worth being clear why. The notice is the
// only artefact s72A(4) actually requires, and by its own words it AMENDS the
// agency agreement — the REINSW form says "this notice amends the estimated
// selling price in the agency agreement", and that the vendor's consent is not
// required. So the notice is not evidence sitting beside the record; it IS the
// record. Reading the figures off it, rather than asking someone to retype
// them next to it, means the number every price check uses is the number in
// the document a regulator would be shown.
//
// No manual fallback, on Adam's instruction. A written notice exists by
// definition or the revision did not comply, and the file becomes part of the
// audit pack at settlement so nobody has to go looking for it later.
const REVISED_ESP_TOOL: Anthropic.Tool = {
  name: "record_revised_esp_notice",
  description:
    "Record the revised estimated selling price and service details from a notice served on a vendor under s72A(4) of the Property and Stock Agents Act 2002 (NSW).",
  input_schema: {
    type: "object",
    properties: {
      looksLikeRevisedEspNotice: {
        type: "boolean",
        description:
          "False if this is not a notice revising an estimated selling price. It will usually be headed 'Notice of Revised Estimated Selling Price' and refer to s72A, but any written notice to the vendor that states a new estimated selling price counts, including a letter or a printed email. An agency agreement, a contract, or a market appraisal is NOT this document.",
      },
      revisedEspLow: {
        type: "number",
        description:
          "The lower figure of the revised estimated selling price, as a plain number with no symbols or separators. For a single figure rather than a range, put the same value in both low and high. Only from a figure actually printed on the notice.",
      },
      revisedEspHigh: {
        type: "number",
        description: "The upper figure of the revised estimated selling price. Same rules as revisedEspLow.",
      },
      noticeServedOn: {
        type: "string",
        description:
          "The date the notice was served on the vendor, format YYYY-MM-DD. Look for a 'Date of Service' or similar field first, and fall back to the date beside the agent's signature only if there is no separate service date. Omit if neither is stated.",
      },
      methodOfService: {
        type: "string",
        description:
          "How it was served, as written, e.g. 'Email', 'Post', 'In person'. Omit if the notice does not say.",
      },
      reason: {
        type: "string",
        description:
          "The stated reason the estimated selling price changed, copied or closely paraphrased from the notice. Omit if the notice gives none.",
      },
      evidenceProvidedBeforeNotice: {
        type: "boolean",
        description:
          "True only if the notice itself states that the agent gave the vendor evidence supporting the revised price before or with the notice. The standard forms carry a line or a tick box to this effect (s72A(5) requires it). Omit rather than guessing if the notice is silent.",
      },
    },
    required: ["looksLikeRevisedEspNotice"],
  },
};

export type RevisedEspFields = {
  looksLikeRevisedEspNotice?: boolean;
  revisedEspLow?: number;
  revisedEspHigh?: number;
  noticeServedOn?: string;
  methodOfService?: string;
  reason?: string;
  evidenceProvidedBeforeNotice?: boolean;
};

/** A read that finished (`fields`), or why it didn't. */
export type ReaderResult<T> = { ok: true; fields: T } | { ok: false; why: ReadFailureWhy };

/** Card names for Adam's alert: the card's own label and key. */
function cardName(itemKey: string): string {
  const label = getItem(itemKey)?.label;
  return label ? `${label} (${itemKey})` : itemKey;
}

/**
 * Reads an uploaded revised-ESP notice on a listing's d3 card. Never throws:
 * a read that didn't finish says why (1 Nov 2026: it said only "null", so a
 * notice whose answer was cut off read as a file that wouldn't open). Every
 * read is recorded, and a failed one alerted (lib/documents/read-record).
 */
export async function extractRevisedEspNotice(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  path: string,
  fileName: string,
  propertyId: string,
): Promise<ReaderResult<RevisedEspFields>> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, why: "service" };
  const where = { reader: "revised_esp_notice", card: cardName("d3"), fileName, propertyId } as const;
  const failed = async (why: ReadFailureWhy, error?: unknown): Promise<ReaderResult<RevisedEspFields>> => {
    await noteRead(supabase, { ...where, outcome: "failed", why, error });
    return { ok: false, why };
  };

  try {
    const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) return failed("file");

    // The read that failed on 16 Greenmount Way, 26 Aug 2026. The notice was a
    // photograph taken on an iPhone — IMG_9352.HEIC — and HEIC was not a format
    // this could open, so the block came back null, the read returned null, and
    // the revised figures were never recorded. readableBytes converts it.
    const prepared = await prepareRead(blob, fileName);
    if (!prepared.ok) return failed(prepared.problem === "too_large" ? "too_large" : "unsupported");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 512,
      system:
        "You are reading a notice served on a vendor that revises the estimated selling price of a NSW " +
        "residential property. Record only figures and dates printed on the document. Never calculate, infer or " +
        "adjust a price. The figures you return become the price every underquoting check in this product " +
        "measures the agency's advertising against, so a wrong number here produces a wrong compliance finding " +
        "on a real file. If you cannot read a figure cleanly, omit it and let a person enter it.",
      text: `This was uploaded as "${fileName}". Call record_revised_esp_notice.`,
      tool: REVISED_ESP_TOOL,
    });
    if (answers.length === 0) return failed("no_answer");
    const fields = mergeReads(answers) as RevisedEspFields;
    await noteRead(supabase, {
      ...where,
      outcome: fields.looksLikeRevisedEspNotice === false ? "wrong_document" : "read",
    });
    return { ok: true, fields };
  } catch (err) {
    return failed(readFailureWhy(err), err);
  }
}

// ── The solicitor's covering letter ────────────────────────────────────────
//
// Adam, 20 Oct 2026: on a live listing the letter enclosing the draft contract
// was uploaded to "Date the contract was received" (b1a) and the documents
// were read. The contract was read; the letter never was, so the received
// date stayed blank. It is read now, for its own date and nothing else, and
// that date is offered on the card for the agent to check, like every other
// date read off a document. The rules and words are in
// lib/documents/covering-letter.ts.
const COVERING_LETTER_TOOL: Anthropic.Tool = {
  name: "record_covering_letter_date",
  description:
    "Record the date of a letter or email from a solicitor or conveyancer that encloses or forwards a contract for sale.",
  input_schema: {
    type: "object",
    properties: {
      letterDate: {
        type: "string",
        description:
          "The date of the letter or email itself, format YYYY-MM-DD: the date printed at the top of the letter, " +
          "or the Date or Sent line of an email. Not the date of the contract, an exchange or settlement date, " +
          "or any other date mentioned in the text. Omit it if the letter or email has no clear date of its own, " +
          "or if this file is not a letter or email at all.",
      },
    },
  },
};

/**
 * Reads an uploaded covering letter for its own date. Never throws: a read
 * that didn't finish says why (1 Nov 2026: one cut off at the limit read as a
 * letter with no date). Every read is recorded, and a failed one alerted.
 */
export async function extractCoveringLetterDate(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  path: string,
  fileName: string,
  propertyId: string,
): Promise<ReaderResult<{ letterDate?: string }>> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, why: "service" };
  const where = { reader: "covering_letter", card: cardName(COVERING_LETTER_KEY), fileName, propertyId } as const;
  const failed = async (why: ReadFailureWhy, error?: unknown): Promise<ReaderResult<{ letterDate?: string }>> => {
    await noteRead(supabase, { ...where, outcome: "failed", why, error });
    return { ok: false, why };
  };

  try {
    const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) return failed("file");

    const prepared = await prepareRead(blob, fileName);
    if (!prepared.ok) return failed(prepared.problem === "too_large" ? "too_large" : "unsupported");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 256,
      system:
        "You are reading the covering letter or email a NSW solicitor or conveyancer sent to a real estate " +
        "agency with the draft contract for sale. Record only the date of the letter itself, exactly as printed. " +
        "Never infer or calculate a date. The date you return is offered to the agent as the date the contract " +
        "was received, and they check it against the letter, so if no date is clearly printed, omit it.",
      text: `This was uploaded as "${fileName}". Call record_covering_letter_date.`,
      tool: COVERING_LETTER_TOOL,
    });
    if (answers.length === 0) return failed("no_answer");
    const fields = mergeReads(answers) as { letterDate?: string };
    await noteRead(supabase, { ...where, outcome: fields.letterDate ? "read" : "nothing_found" });
    return { ok: true, fields };
  } catch (err) {
    return failed(readFailureWhy(err), err);
  }
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
// BROADENED 20 Aug 2026, same conversation: "not just a driver's licence. It
// could be a passport. It could be a council rate. It could be a title
// certificate. None of these things we really want in there."
//
// That widens the idea past identity documents as such. The useful line is
// SOURCE DOCUMENT vs VERIFICATION RECORD. The things people gather to prove
// who someone is and where they live — licence, passport, rates notice,
// utility bill, bank statement, title search — are all source documents, and
// none of them belong on this card. What belongs is the record that a check
// was performed against them.
//
// SCOPED TO a1 DELIBERATELY, and this matters if anyone widens the flag later:
// a certificate of title and a council rates notice are perfectly legitimate
// on OTHER items — a title search is a s52A prescribed document inside the
// contract (b1), and rates notices turn up in settlement paperwork. It is only
// on the identity card that their presence means someone has filed the raw
// evidence instead of the verification. Turning rejectIdDocuments on globally
// would start refusing contracts.
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
    "Decide whether an uploaded file is a source document evidencing a person's identity, address or " +
    "ownership — which must not be stored — as opposed to a record that a verification check was carried out.",
  input_schema: {
    type: "object",
    properties: {
      isIdentityDocument: {
        type: "boolean",
        description:
          "The question is whether this file is a SOURCE DOCUMENT used to establish who someone is or where " +
          "they live, rather than a RECORD that such a check was carried out. Only the record belongs here.\n" +
          "TRUE — a copy, scan, photo or screenshot of any of these, whether on its own or as the substance " +
          "of the file behind a cover page: a driver's licence; a passport; a birth, marriage, citizenship or " +
          "change-of-name certificate; a Medicare or proof-of-age card; a visa grant; a council rates notice; " +
          "a utility or telephone bill; a bank or credit-card statement; a certificate of title or title " +
          "search; any other document whose role is to evidence a person's identity, address or ownership.\n" +
          "FALSE — a report ABOUT a check: a verification-of-identity certificate, an identity verification " +
          "report, an e-signing completion certificate or audit trail, a CDD or KYC outcome summary. These " +
          "are exactly what this card asks for. Answer FALSE even when they quote licence or document " +
          "numbers, expiry dates or addresses, and even when they reproduce a small thumbnail of the document " +
          "that was checked. What the file IS decides this, not what it mentions.\n" +
          "FALSE — ordinary conveyancing paperwork that happens to have been attached: an agency agreement, " +
          "a contract for sale, a planning certificate, an inspection report, a comparable-sales report.\n" +
          "If you genuinely cannot tell, answer FALSE. A wrong rejection blocks an agent from filing a " +
          "legitimate compliance record, and they have already been warned in writing.",
      },
      documentKind: {
        type: "string",
        description:
          "Two or three words naming what the file appears to be, as you would say it to the agent — e.g. " +
          "\"a driver's licence\", 'a passport photo page', 'a council rates notice', 'a certificate of " +
          "title'. Used to tell them exactly what was refused.",
      },
    },
    required: ["isIdentityDocument"],
  },
};

/** The screen's answer: what to refuse the file as, or that it couldn't look, and why. */
export type IdScreen = { looksLike: string | null; failed: ReadFailureWhy | null };

/**
 * Screens one already-uploaded file. `looksLike` is null when the file is
 * fine, or a short description of what it looks like when it must be refused.
 *
 * FAILS OPEN. If the download fails, the file can't be read, or the model
 * errors or its answer is cut off, the file is not refused and the upload
 * proceeds. That is a deliberate trade: a screen that blocks every attachment
 * whenever an external service hiccups would stop agents filing compliance
 * records, and the written warning on the card is still in place. It does
 * mean the screen is a safety net, not a guarantee — flagged to Adam.
 *
 * Never silently (1 Nov 2026): a screen that couldn't look says why in
 * `failed`, is logged as an error and recorded, alerts Adam, and the card says
 * the file went on without the check. Before, it went on with no word at all.
 */
export async function screenForIdDocument(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  path: string,
  fileName: string,
  propertyId: string,
  itemKey: string,
): Promise<IdScreen> {
  if (!process.env.ANTHROPIC_API_KEY) return { looksLike: null, failed: null };
  const where = { reader: "id_screen", card: cardName(itemKey), fileName, propertyId } as const;
  const failed = async (why: ReadFailureWhy, error?: unknown): Promise<IdScreen> => {
    await noteRead(supabase, { ...where, outcome: "failed", why, error });
    return { looksLike: null, failed: why };
  };

  try {
    const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
    if (error || !blob) return failed("file");

    const prepared = await prepareRead(blob, fileName);
    // A file type we cannot read cannot be screened. Let it through rather
    // than refusing on the basis of not having looked. The same for a file
    // too large to read at all (a large PDF is read in parts, every part
    // screened).
    if (!prepared.ok) return failed(prepared.problem === "too_large" ? "too_large" : "unsupported");

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 256,
      system:
        "You are screening a file an Australian real-estate agent is attaching to the 'vendor identity " +
        "verified' item on a compliance record. The purpose is to keep personal source documents — the things " +
        "gathered to prove who someone is, where they live, or what they own — out of the system, while " +
        "letting through the record that a verification was carried out. Judge only what you were shown. " +
        "Answer FALSE when uncertain: refusing a legitimate compliance record is a real cost, and this screen " +
        "backs up a written warning rather than replacing it.",
      text: `This was uploaded as "${fileName}". Call screen_for_identity_documents.`,
      tool: ID_SCREEN_TOOL,
    });

    // Any part that is an identity document makes the file one, named as
    // that part named it.
    const hit = (answers as Array<{ isIdentityDocument?: boolean; documentKind?: string }>).find(
      (a) => a.isIdentityDocument,
    );
    await noteRead(supabase, { ...where, outcome: "read" });
    if (!hit) return { looksLike: null, failed: null };
    return { looksLike: hit.documentKind?.trim() || "a personal identity or ownership document", failed: null };
  } catch (err) {
    return failed(readFailureWhy(err), err);
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
  // The listing the report is for, for the record of reads and Adam's alert.
  propertyId?: string,
): Promise<{ error: string | null; fields?: ReportExtractionFields }> {
  const { supabase } = await requireAuthContext();

  if (!process.env.ANTHROPIC_API_KEY) {
    return { error: "AI extraction isn't set up yet — add ANTHROPIC_API_KEY in Vercel's Environment Variables first." };
  }

  // Every read recorded, and a failed one alerted (1 Nov 2026; lib/documents/read-record).
  const where = { reader: "inspection_report", card: cardName("f3"), fileName, propertyId: propertyId ?? null } as const;
  const failed = (why: ReadFailureWhy, error?: unknown) => noteRead(supabase, { ...where, outcome: "failed", why, error });

  const { data: blob, error } = await supabase.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) {
    await failed("file");
    return { error: "Couldn't download the uploaded file." };
  }
  const unreadable = await downloadedFileProblem(blob, fileName);
  if (unreadable) {
    await failed("file");
    return { error: unreadable };
  }

  const prepared = await prepareRead(blob, fileName);
  if (!prepared.ok) {
    await failed(prepared.problem === "too_large" ? "too_large" : "unsupported");
    return prepared.problem === "too_large"
      ? { error: TOO_LARGE_TO_READ }
      : { error: `File type not supported for extraction yet (${prepared.contentType}).` };
  }

  const MIN_TEXT_CHARS = 400;
  if (prepared.contentType === "text/plain") {
    const text = Buffer.from(prepared.bytes).toString("utf-8");
    if (text.trim().length < MIN_TEXT_CHARS) {
      await noteRead(supabase, { ...where, outcome: "nothing_found" });
      return { error: null, fields: {} };
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Caught (25 Oct 2026). Uncaught, a file over the reader's limits threw
  // straight through to the card, which sat on "Reading…".
  let answers: Array<Record<string, unknown>>;
  try {
    answers = await askParts(anthropic, prepared.parts, {
      maxTokens: 1024,
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
      text: `This document was uploaded as "${fileName}" for the pre-purchase inspection report register. Call record_report_details with whatever it explicitly states.`,
      tool: REPORT_EXTRACTION_TOOL,
    });
  } catch (e) {
    const why = readFailureWhy(e);
    await failed(why, e);
    return {
      error: failedReadSentence(why, "the report", "Enter the details yourself, or upload it again.", `${READ_FAILED_JUST_NOW} Or enter the details yourself.`),
    };
  }

  await noteRead(supabase, { ...where, outcome: "read" });
  return { error: null, fields: mergeReads(answers) as ReportExtractionFields };
}

/**
 * Downloads one listing document from its card, checks the file opens, and
 * reads it (lib/documents/listing-reader). Throws on a failed read.
 */
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
    throw new FileCantBeRead("file", "couldn't download the file");
  }
  const fileName = evidenceFileNameOf(item);
  // Said in full (19 Oct 2026): an empty or damaged file is why a card's
  // details never filled in, and "Read again" is where the agent finds that out.
  const unreadable = await downloadedFileProblem(blob, path.split("/").pop() ?? fileName);
  if (unreadable) throw new FileCantBeRead("file", unreadable);
  return readListingDocument({ anthropic, blob, fileName, source, prescribedDocs });
}

/** The name the file on a card was uploaded as. */
function evidenceFileNameOf(item: PropertyItem): string {
  return (
    (item.data as { evidenceFileName?: string } | null)?.evidenceFileName ??
    item.evidence_path?.split("/").pop() ??
    "document"
  );
}

/** Which reader reads which listing document, for the record of reads. */
const LISTING_READERS: Record<SourceKey, ReaderName> = {
  a3: "agency_agreement",
  b1: "contract",
  a4: "comparable_sales",
};


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
// have not changed. Omitted for the page-level "Read uploaded documents"
// button, which still sweeps everything, the solicitor's covering letter
// included (20 Oct 2026).
export async function extractFromDocuments(propertyId: string): Promise<ActionState> {
  return runExtraction(propertyId);
}

// Called after a document is attached. No-ops silently unless the file landed
// on one of the three items the AI actually reads, so attaching a pool
// certificate or a photo does not spend an AI call.
// The same read, asked for again from the card the document is attached to
// (Adam, 26 Aug 2026: "we upload it, then have to go all the way back up to the
// top of the page for the system to extract the information. I think we should
// have that button showing within the card next to where the evidence has been
// uploaded").
//
// Worth recording that the trip to the top was never doing anything for d3.
// ExtractDocumentsButton calls extractFromDocuments, which is runExtraction
// over the three set-up documents only — it has never touched the revised-ESP
// notice. The read Adam was trying to trigger had already run automatically on
// attach and failed silently on the HEIC. So the button he was pressing did
// nothing, and the thing that did run said nothing. Both halves of that are
// fixed now; this is the half that gives him somewhere to press.
//
// Deliberately the same entry point as the automatic read rather than a
// parallel one. Two code paths that are supposed to do the same thing are two
// code paths that will eventually stop doing the same thing.
export async function rereadAttachedDocument(
  propertyId: string,
  itemKey: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  return extractForAttachment(propertyId, itemKey);
}

export async function extractForAttachment(propertyId: string, itemKey: string): Promise<ActionState> {
  // d3 is not one of the three setup documents and does not go through the
  // per-item allow-list machinery. It has exactly one document and one job:
  // read the revised price off the notice so every underquoting check has the
  // figure currently on foot.
  if (itemKey === "d3") return readRevisedEspNoticeOnto(propertyId);
  // The solicitor's covering letter: read for its date as soon as it's on
  // the card, like the other documents RealComply reads (20 Oct 2026).
  if (itemKey === COVERING_LETTER_KEY) return readCoveringLetterOnto(propertyId);
  if (!(SOURCE_ITEM_KEYS as readonly string[]).includes(itemKey)) return ok;
  return runExtraction(propertyId, itemKey);
}

/**
 * Reads the covering letter on b1a and puts its date on the card as the date
 * the contract was received. The latest action wins (Adam, 20 Oct 2026): the
 * letter's date goes in even over a date the agent typed, as read by AI and
 * left open for the agent to check; the change is kept in the card's
 * history. A letter with no clear date changes nothing and says so. See
 * lib/documents/covering-letter.ts.
 */
async function readCoveringLetterOnto(propertyId: string): Promise<ActionState> {
  const { supabase } = await requireAuthContext();

  const { data: rows } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .in("item_key", [COVERING_LETTER_KEY, "sign_licensee"]);
  const byKey = new Map(((rows ?? []) as PropertyItem[]).map((r) => [r.item_key, r]));
  const item = byKey.get(COVERING_LETTER_KEY) ?? null;
  if (!item?.evidence_path) return ok;

  const fileName =
    (item.data as { evidenceFileName?: string } | null)?.evidenceFileName ??
    item.evidence_path.split("/").pop() ??
    "covering letter";

  const result = await extractCoveringLetterDate(supabase, item.evidence_path, fileName, propertyId);
  if (!result.ok) {
    // Said on the card, not only under Read again (1 Nov 2026): the read on
    // attach swallows its result, so a letter that couldn't be read left the
    // card saying nothing, and one cut off at the limit read as no date.
    const reason = failedReadSentence(result.why, "the covering letter", "Try Read again.", COVERING_LETTER_UNREADABLE);
    const failedWrite = supabase
      .from("property_items")
      .update({ data: afterLetterReadFailed(item, reason, new Date().toISOString()) })
      .eq("property_id", propertyId)
      .eq("item_key", COVERING_LETTER_KEY);
    await (item.event_date ? failedWrite.eq("event_date", item.event_date) : failedWrite.is("event_date", null));
    revalidatePath(`/dashboard/${propertyId}`);
    return { error: reason };
  }
  const fields = result.fields;

  const now = new Date();
  const date = coveringLetterDate(fields.letterDate, sydneyDate(now));
  // A file the licensee has signed off keeps the date it was signed with.
  const signedOff = byKey.get("sign_licensee")?.status === "done";
  if (signedOff && date && date !== item.event_date) return { error: COVERING_LETTER_SIGNED_OFF };

  const next = afterLetterRead(item, date, now.toISOString());
  // Written only if the card still holds the date this read started from:
  // a date the agent saved while the letter was being read came later, and
  // the latest action wins.
  const write = supabase
    .from("property_items")
    .update({
      data: next.data,
      event_date: next.eventDate,
      status: next.status,
      // An open card is not a completed one; the agent completes it again
      // once they have checked the date (see setItemStatus).
      completed_by: next.status === item.status ? item.completed_by : null,
    })
    .eq("property_id", propertyId)
    .eq("item_key", COVERING_LETTER_KEY);
  await (item.event_date ? write.eq("event_date", item.event_date) : write.is("event_date", null));

  revalidatePath(`/dashboard/${propertyId}`);
  return date ? ok : { error: COVERING_LETTER_NO_DATE };
}

/**
 * Reads the notice attached to d3 and records the revised price on it.
 *
 * The figures are written to the item's own data rather than overwriting a4.
 * a4 is what the agency agreement said at listing set-up, and it stays that:
 * a compliance file should show the original estimate AND the revision, not a
 * single figure that quietly changed. effectiveEsp() is what resolves the two
 * into "the price right now" for everything that needs to compare against it.
 */
async function readRevisedEspNoticeOnto(propertyId: string): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: row } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();

  const item = row as PropertyItem | null;
  if (!item?.evidence_path) return ok;

  const fileName =
    (item.data as { evidenceFileName?: string } | null)?.evidenceFileName ??
    item.evidence_path.split("/").pop() ??
    "notice";

  // A failed read has to survive on the item, not just be returned.
  //
  // Until 26 Aug 2026 this returned an error string that the caller logged to
  // the server console and deliberately did not show — reasonable for a
  // comparables report, where a stale finding is the only cost and the
  // page-level button is the retry. It was wrong here. For this document the
  // read IS the record: there was no manual path, so a failed read left the
  // item permanently un-completable with nothing on screen to say why. That is
  // what happened on 16 Greenmount Way, and the first anyone knew of it was a
  // flag at settlement weeks later.
  //
  // Now the failure is written to the item, the card shows it, and the manual
  // fallback (enterRevisedEspManually) opens.
  const markReadFailed = async (reason: string) => {
    await supabase
      .from("property_items")
      .update({
        agency_id: profile.agency_id,
        data: {
          ...((item.data as Record<string, unknown>) ?? {}),
          espRevised: true,
          noticeReadFailed: true,
          noticeReadFailedReason: reason,
          noticeReadAttemptedAt: new Date().toISOString(),
        },
      })
      .eq("property_id", propertyId)
      .eq("item_key", "d3");
    revalidatePath(`/dashboard/${propertyId}`);
  };

  const result = await extractRevisedEspNotice(supabase, item.evidence_path, fileName, propertyId);
  if (!result.ok) {
    // Why, in plain words (1 Nov 2026). Every failure used to say the file
    // couldn't be opened, including an answer cut off at the reader's limit
    // and a reader that was busy.
    const reason = failedReadSentence(
      result.why,
      "the notice",
      "Try Read again, or put the figures in yourself.",
      "The file couldn't be opened for reading. It may be a format we can't read, or the scan may be damaged.",
    );
    await markReadFailed(reason);
    return {
      error:
        result.why === "file" || result.why === "unsupported" || result.why === "other"
          ? "Couldn't read that notice. Check it opens, then try attaching it again."
          : reason,
    };
  }
  const fields = result.fields;

  if (fields.looksLikeRevisedEspNotice === false) {
    await supabase
      .from("property_items")
      .update({
        data: {
          ...((item.data as Record<string, unknown>) ?? {}),
          noticeNotRecognised: true,
          revisedEspLow: undefined,
          revisedEspHigh: undefined,
          // Distinct from a failed read, and deliberately does NOT open the
          // manual fallback. This document was readable — it just is not a
          // revision notice. Offering to type the revised price beside the
          // wrong document would produce a record pointing at evidence that
          // does not support it.
          noticeReadFailed: undefined,
          noticeReadFailedReason: undefined,
        },
      })
      .eq("property_id", propertyId)
      .eq("item_key", "d3");
    revalidatePath(`/dashboard/${propertyId}`);
    return {
      error:
        "That doesn't look like a notice revising the estimated selling price. Attach the notice you served on the vendor.",
    };
  }

  // Both figures or neither. Half a range would feed a comparison that looks
  // authoritative and is not — see the same rule in effectiveEsp().
  const bothFigures = fields.revisedEspLow != null && fields.revisedEspHigh != null;

  await supabase
    .from("property_items")
    .update({
      agency_id: profile.agency_id,
      data: {
        ...((item.data as Record<string, unknown>) ?? {}),
        espRevised: true,
        noticeNotRecognised: undefined,
        revisedEspLow: bothFigures ? fields.revisedEspLow : undefined,
        revisedEspHigh: bothFigures ? fields.revisedEspHigh : undefined,
        noticeServedOn: fields.noticeServedOn,
        methodOfService: fields.methodOfService,
        reason: fields.reason,
        evidenceProvidedBeforeNotice: fields.evidenceProvidedBeforeNotice,
        noticeReadAt: new Date().toISOString(),
        // Written in the SAME update as the figures rather than in a second
        // pass. markReadFailed spreads the item.data this function loaded at
        // the start, so calling it after this write would put the pre-read
        // values back — including figures from an earlier successful read that
        // this one has just superseded.
        //
        // A clean read clears the failure and the typed-by-hand mark: the
        // figures come off the document again, and the card should stop saying
        // otherwise. A read that could not make out the numbers records why,
        // which is what opens the manual fallback on the card — a handwritten
        // notice, a figure amended in pen, a photo at an angle.
        noticeReadFailed: bothFigures ? undefined : true,
        noticeReadFailedReason: bothFigures
          ? undefined
          : "The notice was read, but the revised price couldn't be made out. If it's handwritten or the photo is unclear, put the figures in yourself.",
        noticeReadAttemptedAt: bothFigures ? undefined : new Date().toISOString(),
        enteredManually: undefined,
      },
    })
    .eq("property_id", propertyId)
    .eq("item_key", "d3");

  revalidatePath(`/dashboard/${propertyId}`);

  if (!bothFigures) {
    return {
      error:
        "Read the notice but couldn't make out the revised price. Open it and check, then re-attach a clearer copy.",
    };
  }
  return ok;
}

/**
 * The page-level read: the three set-up documents, then the solicitor's
 * covering letter (20 Oct 2026). Scoped to one attachment, only that one.
 */
async function runExtraction(propertyId: string, onlyItemKey?: string): Promise<ActionState> {
  if (onlyItemKey) return readSourceDocuments(propertyId, onlyItemKey);

  const { supabase } = await requireAuthContext();
  const { data: rows } = await supabase
    .from("property_items")
    .select("item_key, evidence_path")
    .eq("property_id", propertyId)
    .in("item_key", [...SOURCE_ITEM_KEYS, COVERING_LETTER_KEY]);
  const attached = new Set(
    ((rows ?? []) as Array<{ item_key: string; evidence_path: string | null }>)
      .filter((r) => r.evidence_path)
      .map((r) => r.item_key),
  );
  const hasSources = SOURCE_ITEM_KEYS.some((k) => attached.has(k));
  const hasLetter = attached.has(COVERING_LETTER_KEY);
  if (!hasSources && !hasLetter) {
    return {
      error:
        "No documents attached yet. Attach the agency agreement, contract, comparable-sales report or the solicitor's covering letter first.",
    };
  }

  const results: ActionState[] = [];
  if (hasSources) results.push(await readSourceDocuments(propertyId));
  if (hasLetter) results.push(await readCoveringLetterOnto(propertyId));
  const errors = results.map((r) => r.error).filter((e): e is string => Boolean(e));
  return errors.length > 0 ? { error: errors.join(" ") } : ok;
}

async function readSourceDocuments(propertyId: string, onlyItemKey?: string): Promise<ActionState> {
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
  const READ_ORDER: SourceKey[] = ["b1", "a4", "a3"];
  const withEvidence = ((rows ?? []) as PropertyItem[])
    .filter((i) => i.evidence_path)
    .filter((i) => !onlyItemKey || i.item_key === onlyItemKey)
    .sort((x, y) => READ_ORDER.indexOf(x.item_key as SourceKey) - READ_ORDER.indexOf(y.item_key as SourceKey));

  if (withEvidence.length === 0) {
    return {
      error: "No documents attached yet — attach the agency agreement, contract, or comparable-sales report first.",
    };
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const patches: DraftPatch[] = [];
  const failures: string[] = [];

  // The documents read to the end this run. One that failed was not read, so
  // nothing below may conclude anything from its silence.
  const readToEnd = new Set<string>();
  // The comparable-sales report's outcome, kept on its card (lib/documents/report-read).
  let reportRead: ReportRead | null = null;
  for (const item of withEvidence) {
    const readAt = new Date().toISOString();
    // Every read recorded, a failed one logged as an error, and Adam alerted
    // the same day when one fails or the comparable-sales report gives 0
    // comparables (1 Nov 2026; lib/documents/read-record).
    const where = {
      reader: LISTING_READERS[item.item_key as SourceKey],
      card: cardName(item.item_key),
      fileName: evidenceFileNameOf(item),
      propertyId,
    };
    try {
      const found = await extractOneDocument(supabase, anthropic, item, prescribedDocs);
      patches.push(...found);
      readToEnd.add(item.item_key);
      if (item.item_key === "a4") {
        reportRead = reportReadFrom(found, item.evidence_path!, readAt);
        await noteRead(supabase, { ...where, outcome: reportRead.outcome, sales: reportRead.sales ?? 0 });
      } else {
        const wrong = found.some((p) => p.wrongDocument);
        await noteRead(supabase, { ...where, outcome: wrong ? "wrong_document" : found.length > 0 ? "read" : "nothing_found" });
      }
    } catch (err) {
      const why = readFailure(err);
      failures.push(`${SOURCE_LABELS[item.item_key] ?? item.item_key}: ${why}`);
      if (item.item_key === "a4") reportRead = reportReadFailed(why, item.evidence_path!, readAt);
      await noteRead(supabase, { ...where, outcome: "failed", error: err });
    }
  }

  // Whether the agency agreement itself was read, to the end. Only if it was
  // can we conclude anything about the consumer-guide acknowledgement: a run
  // scoped to the contract or the comparables says nothing either way, and
  // nor does a read of the agreement that failed (30 Oct 2026: before, a
  // failed read still let the cards say the guide and VOI weren't in it).
  const readAgencyAgreement = readToEnd.has("a3");

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

  // The comparable sales, and the subject's own attributes.
  //
  // Same shape as the sale-method pass above and for the same reason: this
  // writes outside property_items, so it needs its own rules rather than the
  // generic patch loop's.
  //
  // Two of those rules matter more than the rest:
  //
  //   1. THE AGENT'S WORK IS NEVER OVERWRITTEN. A row they have weighted or
  //      written a note on survives a re-read untouched, and a row they typed
  //      themselves is never replaced by one the model read. Someone who
  //      re-attaches a corrected report should not lose an afternoon's
  //      judgement to it.
  //   2. SUBJECT ATTRIBUTES ARE ONLY EVER SUGGESTIONS HERE. They land in
  //      attribute_suggestions and stay there until a person confirms them.
  //      A figure a model read off a PDF and a figure the agent stands behind
  //      are different things, and the record has to be able to tell them
  //      apart.
  const comparablesPatch = patches.find(
    (p) =>
      p.itemKey === "a4c" &&
      ((p.comparableSales?.length ?? 0) > 0 || (p.marketListings?.length ?? 0) > 0 || p.subjectProperty),
  );
  if (comparablesPatch) {
    const { data: agencyIdRow } = await supabase
      .from("properties")
      .select("agency_id, bedrooms, bathrooms, car_spaces, land_size_sqm, internal_area_sqm, attributes_confirmed_at")
      .eq("id", propertyId)
      .maybeSingle();
    const propertyRowNow = agencyIdRow as Record<string, unknown> | null;
    const agencyId = propertyRowNow?.agency_id as string | undefined;

    if (agencyId && comparablesPatch.subjectProperty) {
      // Offered, not applied. And not offered at all once the agent has
      // confirmed the details themselves — re-reading a report should not
      // reopen a question they have already answered.
      if (!propertyRowNow?.attributes_confirmed_at) {
        await supabase
          .from("properties")
          .update({ attribute_suggestions: comparablesPatch.subjectProperty })
          .eq("id", propertyId);
      }
    }

    if (agencyId && comparablesPatch.comparableSales?.length) {
      const { data: existingRows } = await supabase
        .from("property_comparables")
        .select("id, address")
        .eq("property_id", propertyId);

      const seen = new Set(
        ((existingRows ?? []) as Array<{ address: string }>).map((r) => normaliseAddress(r.address)),
      );

      const fresh = comparablesPatch.comparableSales
        .filter((c) => c.address?.trim())
        .filter((c) => !seen.has(normaliseAddress(c.address)))
        .map((c, index) => ({
          agency_id: agencyId,
          property_id: propertyId,
          address: c.address.trim(),
          sale_price: c.salePrice ?? null,
          sale_date: c.saleDate ?? null,
          bedrooms: c.bedrooms ?? null,
          bathrooms: c.bathrooms ?? null,
          car_spaces: c.carSpaces ?? null,
          land_size_sqm: c.landSizeSqm ?? null,
          internal_area_sqm: c.internalAreaSqm ?? null,
          distance_m: c.distanceM ?? null,
          property_type: c.propertyType ?? null,
          source: "report",
          position: seen.size + index,
        }));

      if (fresh.length > 0) {
        await supabase.from("property_comparables").insert(fresh);
      }
    }

    // ON THE MARKET (29 Sep 2026). Same two rules as the sales: a re-read
    // only ever ADDS listings it has not seen (matched on the normalised
    // address), and it never writes a weighting. Only the ORIGINAL list
    // (as_at null) is checked for duplicates — a list recorded at an ESP
    // revision is a different snapshot and may legitimately repeat an
    // address. If migration 0050 has not been run the insert fails quietly
    // and the sales above are unaffected.
    if (agencyId && comparablesPatch.marketListings?.length) {
      const { data: existingListings } = await supabase
        .from("property_market_listings")
        .select("id, address")
        .eq("property_id", propertyId)
        .is("as_at", null);

      const seenListings = new Set(
        ((existingListings ?? []) as Array<{ address: string }>).map((r) => normaliseAddress(r.address)),
      );

      const freshListings = comparablesPatch.marketListings
        .filter((l) => l.address?.trim())
        .filter((l) => !seenListings.has(normaliseAddress(l.address)))
        .map((l, index) => ({
          agency_id: agencyId,
          property_id: propertyId,
          address: l.address.trim(),
          asking_price: l.askingPrice?.trim() || null,
          sale_method: l.saleMethod?.trim() || null,
          listed_date: /^\d{4}-\d{2}-\d{2}$/.test(l.listedDate ?? "") ? l.listedDate : null,
          bedrooms: l.bedrooms ?? null,
          bathrooms: l.bathrooms ?? null,
          car_spaces: l.carSpaces ?? null,
          land_size_sqm: l.landSizeSqm ?? null,
          internal_area_sqm: l.internalAreaSqm ?? null,
          distance_m: l.distanceM ?? null,
          property_type: l.propertyType ?? null,
          source: "report",
          as_at: null,
          position: seenListings.size + index,
        }));

      if (freshListings.length > 0) {
        await supabase.from("property_market_listings").insert(freshListings);
      }
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
    //
    // Nor a card a person reopened (Adam, 28 Oct 2026). Before, the next read
    // of the agreement ticked a reopened a1 or a2 straight back, so a reopen
    // didn't stay. The reopen stamp (reopenedAt, 0100) goes when the card is
    // marked done again.
    const reopenedByAPerson = Boolean((existing?.data as { reopenedAt?: unknown } | null | undefined)?.reopenedAt);
    const autoComplete =
      !patch.wrongDocument &&
      !!patch.eventDate &&
      (existing?.status ?? "open") === "open" &&
      !reopenedByAPerson &&
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
            // a3 only. Seeds b4's "what the price statement is" note, which is
            // a licensee-only item extraction must never write to directly —
            // so it is parked here on the agreement's own card and read across
            // by the b4 card. See ItemCard.
            offerPrice: patch.offerPrice,
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
  const readSources = withEvidence.filter((i) => readToEnd.has(i.item_key)).map((i) => i.item_key as SourceKey);
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

  // What the comparable-sales report's read came to, on its card: read with
  // what it found, read with nothing in it, couldn't be read, or the wrong
  // document. Written last, over the latest copy of the card, because the
  // agreement's ESP figures may have just been written to the same card.
  // Never touches the ESP the agent typed, or anything else on the card.
  if (reportRead) {
    const { data: a4Row } = await supabase
      .from("property_items")
      .select("data")
      .eq("property_id", propertyId)
      .eq("item_key", "a4")
      .maybeSingle();
    const a4Data = ((a4Row as { data?: Record<string, unknown> | null } | null)?.data ?? {}) as Record<string, unknown>;
    const { error: reportReadError } = await supabase
      .from("property_items")
      .update({ data: { ...a4Data, reportRead } })
      .eq("property_id", propertyId)
      .eq("item_key", "a4");
    if (reportReadError) console.error("report read not recorded:", propertyId, reportReadError.message);
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

// Address matching for the re-read guard above.
//
// Deliberately crude: lowercase, collapse whitespace and punctuation, and drop
// the common street-type abbreviations so "14 Smith St" and "14 Smith Street"
// are one property rather than two. It does not need to be clever — the only
// job is stopping a second read of the same report from doubling every row,
// and a false miss shows up as a visible duplicate the agent can remove, while
// a false match would silently hide a genuinely different sale. Erring towards
// the visible failure is the right way round.
function normaliseAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\b(street|st|road|rd|avenue|ave|drive|dr|place|pl|court|ct|crescent|cres|parade|pde|lane|ln|way|close|cl|terrace|tce)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
