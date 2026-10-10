// Reading a licence or certificate of registration off an uploaded document,
// and deciding what to save. Pure: no database, no model call. The server
// actions in lib/actions/licences.ts do the I/O and ask this what to write,
// which is what lets every rule below be tested without either.
//
// Adam's rule (a), Oct 2026: upload, don't type. If a fact is on an uploaded
// document, the app reads it. Typing is only the fallback, and the way to
// correct a wrong read.
//
// THE RULES, as decided here:
//
//   * A clear read is saved straight to the record. No confirm step: the card
//     says the values were read from the document and offers a plain way to
//     change them, so review happens after rather than before.
//   * A field that cannot be read with confidence is left EMPTY, named on the
//     card, and asked for on its own. Never guessed, and a date least of all.
//     A new document governs: a field it does not state is not carried over
//     from the document it replaced.
//   * If the holder name on the document does not match the person (or the
//     agency, for the corporation licence), NOTHING is saved and the card
//     warns. Uploading a colleague's licence onto the wrong card is the likely
//     mistake, and saving it would start someone else's reminder schedule.
//   * An expiry date already in the past is saved and shown as expired. The
//     upload is not blocked: an expired licence on file is a fact the
//     licensee needs to see, not something to refuse.

import type { LicenceType } from "@/lib/types";

export type LicenceField = "holderName" | "licenceType" | "licenceNumber" | "expiry";

export const LICENCE_FIELD_LABELS: Record<LicenceField, string> = {
  holderName: "holder name",
  licenceType: "licence type",
  licenceNumber: "licence number",
  expiry: "expiry date",
};

/** Which fields each kind of record keeps. The corporation licence has no
 *  type column; a person's name lives on their profile, not here. */
export const FIELDS_KEPT: Record<LicenceSubject, LicenceField[]> = {
  person: ["licenceType", "licenceNumber", "expiry"],
  corporation: ["holderName", "licenceNumber", "expiry"],
};

export type LicenceSubject = "person" | "corporation";

export type DocumentKind = "licence" | "certificate_of_registration" | "corporation_licence" | "other";

/** What the reader returned, after validation. Anything absent was not read. */
export type LicenceDocumentRead = {
  documentIs: DocumentKind | null;
  holderName: string | null;
  licenceType: LicenceType | null;
  licenceNumber: string | null;
  expiry: string | null;
};

export type FieldSource = {
  source: "document" | "typed";
  /** Profile id of whoever uploaded or typed it. */
  by: string | null;
  at: string;
};

export type LastReadStatus = "read" | "name_mismatch" | "not_a_licence" | "could_not_read";

/** Stored as profiles.licence_read / agencies.corporation_licence_read. */
export type LicenceReadState = {
  lastRead: {
    status: LastReadStatus;
    at: string;
    by: string | null;
    fileName: string | null;
    /** The name as printed on the document, when it could be read. */
    nameOnDocument: string | null;
    /** False when there was nothing to compare the name against. */
    nameChecked: boolean;
  } | null;
  /** Fields the last read could not fill and nobody has typed in since. */
  missing: LicenceField[];
  /** Where each current value came from. */
  fields: Partial<Record<LicenceField, FieldSource>>;
};

export type LicenceValues = {
  holderName: string | null;
  licenceType: LicenceType | null;
  licenceNumber: string | null;
  expiry: string | null;
};

const LICENCE_TYPES: ReadonlySet<string> = new Set(["class_1", "class_2", "certificate_of_registration"]);
const DOCUMENT_KINDS: ReadonlySet<string> = new Set([
  "licence",
  "certificate_of_registration",
  "corporation_licence",
  "other",
]);

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

/** A real calendar date in YYYY-MM-DD, or null. 2027-02-30 is not a date. */
export function validIsoDate(value: unknown): string | null {
  const s = cleanText(value);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return s;
}

/**
 * Turns whatever the model sent into something safe to act on. A field the
 * model marked unreadable, or sent in a shape that fails validation, is
 * treated as not read. That is the whole of "never guess": nothing reaches
 * the record unless it arrived clean.
 */
export function sanitiseLicenceRead(raw: unknown): LicenceDocumentRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // The tool names the date "expiryDate" (it is what is printed); the record
  // calls the field "expiry". Normalised here so a flagged date is never kept.
  const unreadable = new Set(
    (Array.isArray(r.unreadableFields) ? r.unreadableFields : [])
      .filter((f): f is string => typeof f === "string")
      .map((f) => (f === "expiryDate" ? "expiry" : f)),
  );
  const take = <T>(field: LicenceField, value: T | null): T | null => (unreadable.has(field) ? null : value);

  const type = cleanText(r.licenceType);
  const kind = cleanText(r.documentIs);
  return {
    documentIs: kind && DOCUMENT_KINDS.has(kind) ? (kind as DocumentKind) : null,
    holderName: take("holderName", cleanText(r.holderName)),
    licenceType: take("licenceType", type && LICENCE_TYPES.has(type) ? (type as LicenceType) : null),
    licenceNumber: take("licenceNumber", cleanText(r.licenceNumber)),
    expiry: take("expiry", validIsoDate(r.expiryDate)),
  };
}

// ── Names ───────────────────────────────────────────────────────────────────
//
// Order-insensitive and forgiving of the ways a licence prints a name
// ("SMITH, Jane Maree" for "Jane Smith"), but not of a different person.
// A person matches when their first and last names both appear on the
// document. A company matches when the words left after dropping "Pty Ltd"
// and the like are all there, either way round.

const COMPANY_NOISE = new Set(["pty", "ltd", "limited", "proprietary", "the", "and", "co", "inc", "atf", "trust", "trustee", "for"]);

function words(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[&]/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function personNameMatches(onDocument: string, person: string): boolean {
  const doc = new Set(words(onDocument));
  const mine = words(person);
  if (mine.length === 0) return false;
  if (mine.length === 1) return doc.has(mine[0]);
  return doc.has(mine[0]) && doc.has(mine[mine.length - 1]);
}

export function companyNameMatches(onDocument: string, company: string): boolean {
  const strip = (s: string) => words(s).filter((w) => !COMPANY_NOISE.has(w));
  const doc = strip(onDocument);
  const mine = strip(company);
  if (doc.length === 0 || mine.length === 0) return false;
  const docSet = new Set(doc);
  const mineSet = new Set(mine);
  return mine.every((w) => docSet.has(w)) || doc.every((w) => mineSet.has(w));
}

// ── The decision ───────────────────────────────────────────────────────────

export type ReadDecision =
  | {
      kind: "save";
      /** Every kept field: the value read, or null where it could not be. */
      values: LicenceValues;
      state: LicenceReadState;
      /** The expiry read is already in the past. Saved anyway. */
      expired: boolean;
    }
  | { kind: "name_mismatch"; nameOnDocument: string; state: LicenceReadState }
  | { kind: "not_a_licence"; state: LicenceReadState };

export function decideLicenceRead(input: {
  read: LicenceDocumentRead;
  subject: LicenceSubject;
  /** Names the holder may appear under. For a person, their full name; for
   *  the corporation, the recorded holder and the agency name. Empty means
   *  there is nothing to check against. */
  expectedNames: string[];
  previous: LicenceReadState | null;
  by: string | null;
  at: string;
  fileName: string | null;
  today: Date;
}): ReadDecision {
  const { read, subject, by, at, fileName } = input;
  const previous = input.previous ?? emptyState();
  const expected = input.expectedNames.map((n) => n.trim()).filter(Boolean);
  const nameOnDocument = read.holderName;

  const lastRead = (status: LastReadStatus, nameChecked: boolean) => ({
    status,
    at,
    by,
    fileName,
    // Only a document that went on the record keeps the name printed on it.
    // A refused one is usually someone else's licence, and their name has no
    // business in this person's record (10 Oct 2026). The one-off message
    // in the uploader's browser still says whose it was.
    nameOnDocument: status === "read" ? nameOnDocument : null,
    nameChecked,
  });

  // A tax invoice or a CPD certificate in the licence slot. Nothing it says
  // about names or dates belongs on a licence record.
  if (read.documentIs === "other") {
    return { kind: "not_a_licence", state: { ...previous, lastRead: lastRead("not_a_licence", false) } };
  }

  const matches = subject === "person" ? personNameMatches : companyNameMatches;
  const nameChecked = Boolean(nameOnDocument) && expected.length > 0;
  if (nameChecked && !expected.some((n) => matches(nameOnDocument as string, n))) {
    return {
      kind: "name_mismatch",
      nameOnDocument: nameOnDocument as string,
      state: { ...previous, lastRead: lastRead("name_mismatch", true) },
    };
  }

  const kept = FIELDS_KEPT[subject];
  const values: LicenceValues = { holderName: null, licenceType: null, licenceNumber: null, expiry: null };
  const fields: Partial<Record<LicenceField, FieldSource>> = {};
  const missing: LicenceField[] = [];
  for (const field of kept) {
    const value = read[field];
    if (value) {
      (values as Record<LicenceField, string | null>)[field] = value;
      fields[field] = { source: "document", by, at };
    } else {
      missing.push(field);
    }
  }

  const expired = Boolean(values.expiry) && isBeforeToday(values.expiry as string, input.today);

  return {
    kind: "save",
    values,
    expired,
    state: { lastRead: lastRead("read", nameChecked), missing, fields },
  };
}

/**
 * The state after someone types values in by hand. Each changed field is
 * marked as typed, by whom and when, and stops being asked for once it has a
 * value. A warning left by a mismatched or wrong upload is cleared: the
 * person has since dealt with the record directly.
 */
export function recordTypedChanges(
  previous: LicenceReadState | null,
  subject: LicenceSubject,
  before: LicenceValues,
  after: LicenceValues,
  by: string | null,
  at: string,
): LicenceReadState {
  const state = previous ?? emptyState();
  const fields = { ...state.fields };
  for (const field of FIELDS_KEPT[subject]) {
    if ((before[field] ?? null) !== (after[field] ?? null)) {
      fields[field] = { source: "typed", by, at };
    }
  }
  const missing = state.missing.filter((f) => !after[f]);
  const lastRead =
    state.lastRead && (state.lastRead.status === "name_mismatch" || state.lastRead.status === "not_a_licence")
      ? null
      : state.lastRead;
  return { lastRead, missing, fields };
}

export function emptyState(): LicenceReadState {
  return { lastRead: null, missing: [], fields: {} };
}

/** Reads a stored jsonb value defensively; anything unexpected is no state. */
export function parseReadState(raw: unknown): LicenceReadState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<LicenceReadState>;
  return {
    lastRead: r.lastRead ?? null,
    missing: Array.isArray(r.missing) ? r.missing : [],
    fields: r.fields && typeof r.fields === "object" ? r.fields : {},
  };
}

function isBeforeToday(isoDate: string, today: Date): boolean {
  const todayIso = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return isoDate < todayIso;
}
