// Reading an insurance certificate of currency or policy schedule off an
// upload, deciding what to save, and saying what happened. Pure: no database,
// no model call. lib/actions/insurance.ts does the I/O and asks this what to
// write, so every rule below is tested without either.
//
// Trent (Lloyd Property, 15 Oct 2026) asked to attach the certificate to the
// Insurance register so it can be shown to Fair Trading on the spot. Adam
// approved the mockup the same day. Same rules as reading a licence
// (lib/licence-read.ts):
//
//   * A clear read is saved straight to the policy. The card says the details
//     were read from the certificate and Edit corrects anything wrong.
//   * A detail that can't be read with confidence is left EMPTY and asked for
//     on its own. Never guessed, an expiry date least of all.
//   * A new certificate governs. Anything it doesn't state, or that couldn't
//     be read, is asked for, never carried over from last year's.
//   * Not a certificate or a schedule (an invoice, say): nothing is saved and
//     the file is removed.
//   * A certificate for a different cover (workers compensation uploaded on
//     professional indemnity): the same.
//   * An expiry already past is saved and shown as expired, not refused.
//
// And a renewal never overwrites last year's policy (gap audit, 15 Oct 2026):
// the database writes the policy as it was to insurance_history on every
// change (0076). The app's part is saying how the change happened, in
// changeSource, on the same write.

import type { InsuranceHistoryRow, InsurancePolicyType, InsuranceSnapshot } from "@/lib/types";

export type InsuranceField = "insurer" | "policyNumber" | "expiry";

export const INSURANCE_FIELDS: InsuranceField[] = ["insurer", "policyNumber", "expiry"];

export const INSURANCE_FIELD_LABELS: Record<InsuranceField, string> = {
  insurer: "insurer",
  policyNumber: "policy number",
  expiry: "expiry date",
};

export type InsuranceValues = Record<InsuranceField, string | null>;

/** What each policy is, and what cover on a certificate counts as it. */
export const POLICIES: Record<InsurancePolicyType, { title: string; cover: CoverKind; coverWords: string }> = {
  pi: { title: "Professional indemnity insurance", cover: "professional_indemnity", coverWords: "professional indemnity" },
  cyber: { title: "Cybersecurity insurance", cover: "cyber", coverWords: "cyber" },
  icare: { title: "iCare workers insurance", cover: "workers_compensation", coverWords: "workers compensation" },
};

export type DocumentKind = "certificate_of_currency" | "policy_schedule" | "other";

export type CoverKind =
  | "professional_indemnity"
  | "cyber"
  | "workers_compensation"
  | "public_liability"
  | "other";

const COVER_WORDS: Record<CoverKind, string> = {
  professional_indemnity: "professional indemnity",
  cyber: "cyber",
  workers_compensation: "workers compensation",
  public_liability: "public liability",
  other: "other",
};

/** What the reader returned, after validation. Anything absent was not read. */
export type InsuranceDocumentRead = {
  documentIs: DocumentKind | null;
  covers: CoverKind[];
  insurer: string | null;
  policyNumber: string | null;
  expiry: string | null;
};

export type FieldSource = { source: "document" | "typed"; by: string | null; at: string };

export type ChangeSource = "document_read" | "typed" | "document_removed";

/** Stored as agencies.{pi,cyber,icare}_read. */
export type InsuranceReadState = {
  lastRead: {
    status: "read" | "could_not_read";
    at: string;
    by: string | null;
    fileName: string | null;
  } | null;
  /** Details the certificate didn't give and nobody has typed in since. */
  missing: InsuranceField[];
  /** Where each current value came from. */
  fields: Partial<Record<InsuranceField, FieldSource>>;
  /** How the write that stored this state changed the policy. The database
   *  copies it into insurance_history (0076). Set on every write. */
  changeSource: ChangeSource;
};

const DOCUMENT_KINDS: ReadonlySet<string> = new Set(["certificate_of_currency", "policy_schedule", "other"]);
const COVER_KINDS: ReadonlySet<string> = new Set(Object.keys(COVER_WORDS));

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
 * treated as not read. Nothing reaches the policy unless it arrived clean.
 */
export function sanitiseInsuranceRead(raw: unknown): InsuranceDocumentRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // The tool calls the date "expiryDate" (what is printed); the policy calls
  // it "expiry". Normalised here so a flagged date is never kept.
  const unreadable = new Set(
    (Array.isArray(r.unreadableFields) ? r.unreadableFields : [])
      .filter((f): f is string => typeof f === "string")
      .map((f) => (f === "expiryDate" ? "expiry" : f)),
  );
  const take = (field: InsuranceField, value: string | null) => (unreadable.has(field) ? null : value);
  const kind = cleanText(r.documentIs);
  const covers = (Array.isArray(r.covers) ? r.covers : [])
    .map(cleanText)
    .filter((c): c is CoverKind => Boolean(c) && COVER_KINDS.has(c as string));
  return {
    documentIs: kind && DOCUMENT_KINDS.has(kind) ? (kind as DocumentKind) : null,
    covers: [...new Set(covers)],
    insurer: take("insurer", cleanText(r.insurer)),
    policyNumber: take("policyNumber", cleanText(r.policyNumber)),
    expiry: take("expiry", validIsoDate(r.expiryDate)),
  };
}

export type InsuranceReadDecision =
  | { kind: "save"; values: InsuranceValues; state: InsuranceReadState; expired: boolean }
  | { kind: "not_a_certificate" }
  | { kind: "wrong_cover"; coverOnDocument: string };

export function decideInsuranceRead(input: {
  read: InsuranceDocumentRead;
  policy: InsurancePolicyType;
  by: string | null;
  at: string;
  fileName: string | null;
  today: Date;
}): InsuranceReadDecision {
  const { read, policy, by, at, fileName } = input;

  // An invoice, a licence, a blank page in the insurance slot. Nothing it says
  // about insurers or dates belongs on a policy.
  if (read.documentIs === "other") return { kind: "not_a_certificate" };

  // A certificate that names its cover, none of it this policy's. A package
  // policy that lists this cover among others is fine.
  const wanted = POLICIES[policy].cover;
  const named: CoverKind[] = read.covers.filter((c) => c !== "other");
  if (named.length > 0 && !named.includes(wanted)) {
    return { kind: "wrong_cover", coverOnDocument: COVER_WORDS[named[0]] };
  }

  const values: InsuranceValues = { insurer: null, policyNumber: null, expiry: null };
  const fields: Partial<Record<InsuranceField, FieldSource>> = {};
  const missing: InsuranceField[] = [];
  for (const field of INSURANCE_FIELDS) {
    const value = read[field];
    if (value) {
      values[field] = value;
      fields[field] = { source: "document", by, at };
    } else {
      missing.push(field);
    }
  }
  return {
    kind: "save",
    values,
    expired: Boolean(values.expiry) && isBeforeToday(values.expiry as string, input.today),
    state: { lastRead: { status: "read", at, by, fileName }, missing, fields, changeSource: "document_read" },
  };
}

/**
 * A certificate that couldn't be read at all (the file couldn't be opened, or
 * the reader failed). It stays attached, and every detail is asked for: last
 * year's insurer, number and expiry are not this certificate's.
 */
export function couldNotReadState(by: string | null, at: string, fileName: string | null): InsuranceReadState {
  return {
    lastRead: { status: "could_not_read", at, by, fileName },
    missing: [...INSURANCE_FIELDS],
    fields: {},
    changeSource: "document_read",
  };
}

/**
 * The state after someone types details in by hand (Edit, or answering what
 * the read couldn't). Each changed field is marked typed, by whom and when,
 * and stops being asked for once it has a value.
 */
export function recordTypedInsurance(
  previous: InsuranceReadState | null,
  before: InsuranceValues,
  after: InsuranceValues,
  by: string | null,
  at: string,
): InsuranceReadState {
  const state = previous ?? emptyInsuranceState();
  const fields = { ...state.fields };
  for (const field of INSURANCE_FIELDS) {
    if ((before[field] ?? null) !== (after[field] ?? null)) fields[field] = { source: "typed", by, at };
  }
  return {
    lastRead: state.lastRead,
    missing: state.missing.filter((f) => !after[f]),
    fields,
    changeSource: "typed",
  };
}

/** The state once the certificate is taken off the policy. Its details stay. */
export function removedCertificateState(previous: InsuranceReadState | null): InsuranceReadState {
  const state = previous ?? emptyInsuranceState();
  return { lastRead: null, missing: [], fields: state.fields, changeSource: "document_removed" };
}

export function emptyInsuranceState(): InsuranceReadState {
  return { lastRead: null, missing: [], fields: {}, changeSource: "typed" };
}

/** Reads a stored jsonb value defensively; anything unexpected is no state. */
export function parseInsuranceRead(raw: unknown): InsuranceReadState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<InsuranceReadState>;
  const lastRead =
    r.lastRead && typeof r.lastRead === "object" && (r.lastRead.status === "read" || r.lastRead.status === "could_not_read")
      ? r.lastRead
      : null;
  return {
    lastRead,
    missing: Array.isArray(r.missing) ? r.missing.filter((f): f is InsuranceField => INSURANCE_FIELDS.includes(f)) : [],
    fields: r.fields && typeof r.fields === "object" ? r.fields : {},
    changeSource:
      r.changeSource === "document_read" || r.changeSource === "document_removed" ? r.changeSource : "typed",
  };
}

// ── What the card says ──────────────────────────────────────────────────────

/** "insurer, policy number and expiry date" */
export function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Said after an upload is saved. On a renewal (a certificate replacing
 * another) it says how the expiry moved and that last year's is kept.
 */
export function savedMessage(input: {
  state: InsuranceReadState;
  expired: boolean;
  beforeExpiry: string | null;
  afterExpiry: string | null;
  replacedCertificate: boolean;
  formatDate: (iso: string) => string;
}): string {
  const { state, expired, beforeExpiry, afterExpiry, replacedCertificate, formatDate } = input;
  const gaps = state.missing.map((f) => INSURANCE_FIELD_LABELS[f]);
  const parts: string[] = [];
  parts.push(gaps.length === 0 ? "Read from the certificate and saved." : "Read from the certificate and saved what was clear.");
  if (replacedCertificate && beforeExpiry && afterExpiry && beforeExpiry !== afterExpiry) {
    parts.push(`The expiry moved from ${formatDate(beforeExpiry)} to ${formatDate(afterExpiry)}.`);
  }
  if (replacedCertificate) parts.push("The previous certificate is kept in the history.");
  if (gaps.length > 0) parts.push(`Couldn't read the ${joinAnd(gaps)}. Please add ${gaps.length === 1 ? "it" : "them"} below.`);
  if (expired) parts.push("The expiry date on it has already passed.");
  return parts.join(" ");
}

/** How a refused upload ends: removed, or still stored because the delete failed. */
function refusedEnding(kept: boolean): string {
  return kept
    ? "Nothing was saved. RealComply couldn't delete the file just now, so it is still stored, though not on this policy."
    : "Nothing was saved, and the file was removed.";
}

export function notACertificateMessage(kept: boolean): string {
  return `This doesn't look like a certificate of currency or a policy schedule. ${refusedEnding(kept)}`;
}

export function wrongCoverMessage(policy: InsurancePolicyType, coverOnDocument: string, kept: boolean): string {
  return `This looks like ${coverOnDocument} cover, not ${POLICIES[policy].coverWords}. ${refusedEnding(kept)}`;
}

/**
 * The small line under the details: which came from the certificate, which
 * were typed, and when. Null when there's nothing to say.
 */
export function provenanceLine(
  state: InsuranceReadState | null,
  fileName: string | null,
  nameOf: Record<string, string>,
  formatTimestamp: (iso: string) => string,
): string | null {
  if (!state) return null;
  const parts: string[] = [];
  const read = INSURANCE_FIELDS.filter((f) => state.fields[f]?.source === "document");
  if (state.lastRead?.status === "read" && read.length > 0 && fileName) {
    const words = read.map((f) => (f === "expiry" ? "expiry" : INSURANCE_FIELD_LABELS[f]));
    parts.push(`${capitalise(joinAnd(words))} read from ${fileName} on ${formatTimestamp(state.lastRead.at)}.`);
  }
  const typed = INSURANCE_FIELDS.filter((f) => state.fields[f]?.source === "typed");
  if (typed.length > 0) {
    const latest = typed.map((f) => state.fields[f] as FieldSource).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const who = latest.by ? nameOf[latest.by] : null;
    parts.push(
      `${capitalise(joinAnd(typed.map((f) => INSURANCE_FIELD_LABELS[f])))} typed${who ? ` by ${who}` : ""} on ${formatTimestamp(latest.at)}.`,
    );
  }
  if (parts.length > 0 && read.length > 0 && state.missing.length === 0) parts.push("Use Edit to change anything that's wrong.");
  return parts.length > 0 ? parts.join(" ") : null;
}

// ── The history ─────────────────────────────────────────────────────────────

export type HistoryEntry = {
  id: string;
  at: string;
  text: string;
  /** The certificate this change took off the policy, still kept. */
  earlierCertificate: { path: string; fileName: string; details: string } | null;
};

function snapshot(raw: Partial<InsuranceSnapshot> | null | undefined): InsuranceSnapshot {
  const s = raw ?? {};
  return {
    insurer: s.insurer ?? null,
    policyNumber: s.policyNumber ?? null,
    expiry: s.expiry ?? null,
    documentPath: s.documentPath ?? null,
    documentFileName: s.documentFileName ?? null,
  };
}

/** "Made-up Underwriting Pty Ltd · PI-204418 · expired 30 June 2026" */
export function policyDetails(s: InsuranceSnapshot, formatDate: (iso: string) => string, today: Date): string {
  const bits: string[] = [];
  if (s.insurer) bits.push(s.insurer);
  if (s.policyNumber) bits.push(s.policyNumber);
  if (s.expiry) bits.push(`${isBeforeToday(s.expiry, today) ? "expired" : "expires"} ${formatDate(s.expiry)}`);
  return bits.join(" · ");
}

/**
 * One line per change, newest first, in words: a renewal, a first upload, a
 * change by hand, a certificate taken off. Where a change took a certificate
 * off the policy, that certificate is named with the details it carried, so
 * last year's is one click away.
 */
export function describeHistory(
  rows: InsuranceHistoryRow[],
  nameOf: Record<string, string>,
  formatDate: (iso: string) => string,
  formatTimestamp: (iso: string) => string,
  today: Date,
): HistoryEntry[] {
  return [...rows]
    .sort((a, b) => (a.changed_at < b.changed_at ? 1 : a.changed_at > b.changed_at ? -1 : 0))
    .map((row) => {
      const before = snapshot(row.before);
      const after = snapshot(row.after);
      const who = row.changed_by ? nameOf[row.changed_by] : null;
      const byOn = `${who ? ` by ${who}` : ""} on ${formatTimestamp(row.changed_at)}`;
      const replaced = Boolean(before.documentPath) && before.documentPath !== after.documentPath;

      let text: string;
      if (row.source === "document_removed") {
        text = `Certificate taken off${byOn}.`;
      } else if (row.source === "document_read" && replaced) {
        const moved =
          before.expiry && after.expiry && before.expiry !== after.expiry
            ? ` The expiry moved from ${formatDate(before.expiry)} to ${formatDate(after.expiry)}.`
            : "";
        text = `Renewed certificate uploaded${byOn}.${moved}`;
      } else if (row.source === "document_read") {
        text = `Certificate uploaded${byOn}.`;
      } else {
        const changed = INSURANCE_FIELDS.filter((f) => before[f] !== after[f]).map((f) => INSURANCE_FIELD_LABELS[f]);
        text = changed.length > 0 ? `${capitalise(joinAnd(changed))} changed by hand${byOn}.` : `Changed${byOn}.`;
      }

      return {
        id: row.id,
        at: row.changed_at,
        text,
        earlierCertificate: replaced
          ? {
              path: before.documentPath as string,
              fileName: before.documentFileName ?? "certificate",
              details: policyDetails(before, formatDate, today),
            }
          : null,
      };
    });
}

function isBeforeToday(isoDate: string, today: Date): boolean {
  const todayIso = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    .toISOString()
    .slice(0, 10);
  return isoDate < todayIso;
}
