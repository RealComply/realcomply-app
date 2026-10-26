"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { extractLicenceDocument } from "@/lib/actions/extraction";
import { EVIDENCE_BUCKET, isInFolder, storedFileProblem } from "@/lib/storage/evidence";
import { firstName, possessive } from "@/lib/licence-name";
import { pendingReadProblem, signPendingRead, verifyPendingRead } from "@/lib/pending-read";
import { formatAuDate } from "@/lib/format-date";
import {
  decideLicenceRead,
  emptyState,
  parseReadState,
  withoutNameConfirmation,
  recordTypedChanges,
  sanitiseLicenceRead,
  LICENCE_FIELD_LABELS,
  type EntityCheck,
  type LicenceDocumentRead,
  type LicenceReadState,
  type LicenceSubject,
  type LicenceValues,
} from "@/lib/licence-read";
import { asksAboutEntityName } from "@/lib/agency-names";
import { cleanLicenceCategories } from "@/lib/rules/nsw-cpd";
import { sendLicenceReminderTest } from "@/lib/email/licence-reminders";
import type { Agency, LicenceType, Profile } from "@/lib/types";

// Licence and certificate records: reading them off the uploaded document,
// typed corrections, and the history that keeps a renewal traceable.
//
// Moved here from actions/registers.ts (Oct 2026) when the upload started
// reading the document, because every write to a licence record now does the
// same three things: change the record, note where each value came from, and
// append to licence_history. Keeping all of them in one file is what stops a
// fourth write path appearing that skips the history.
//
// WHO MAY DO WHAT is unchanged: a person maintains their own licence, the
// licensee in charge can maintain anyone's, and the corporation licence is the
// licensee's alone. The one-off "Read from document" is the licensee's.
//
// "The licensee" for the corporation licence, the one-off read and the test
// reminder is access.actsAsLicensee, so the agent on their own plan counts
// (10 Oct 2026; 0058 lets them write the agency row). Someone ELSE's licence
// stays with the licensee in charge: only they may update another person's
// profile in the database.

export type ActionState = { error: string | null };

/** What an upload or a read did, in words the card can show as they are. */
export type LicenceReadResult = {
  error: string | null;
  outcome?: "saved" | "saved_with_gaps" | "name_mismatch" | "not_a_licence" | "could_not_read" | "confirm_name" | "removed";
  message?: string;
  /** The name question (15 Oct 2026), when outcome is "confirm_name". */
  question?: NameQuestion;
};

/**
 * "The name on this licence is [name on licence]. Is this [person]'s
 * licence?" with what was read, not saved yet. The token carries the read,
 * signed, back to confirmLicenceName or rejectLicenceName.
 */
export type NameQuestion = {
  token: string;
  nameOnDocument: string;
  personName: string;
  firstName: string;
  /** "Licence 20123456 · Class 2 · Expires 30 June 2028" */
  summary: string;
};

type Snapshot = LicenceValues & {
  documentPath: string | null;
  documentFileName: string | null;
  /** When the name on the document differed and someone confirmed it was this person's (15 Oct 2026). */
  nameOnDocument?: string | null;
  nameConfirmedBy?: string | null;
  nameConfirmedAt?: string | null;
};

/** The server secret the held read is signed with. Never sent anywhere. */
function pendingSecret(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

const TYPE_WORDS: Record<LicenceType, string> = {
  class_1: "Class 1",
  class_2: "Class 2",
  certificate_of_registration: "Certificate of registration",
};

/** "Licence 20123456 · Class 2 · Expires 30 June 2028", from what was read. */
function readSummary(read: LicenceDocumentRead): string {
  const what = read.licenceType === "certificate_of_registration" ? "Certificate" : "Licence";
  return [
    read.licenceNumber ? `${what} ${read.licenceNumber}` : `${what} number not read`,
    read.licenceType ? TYPE_WORDS[read.licenceType] : null,
    read.expiry ? `Expires ${formatAuDate(read.expiry)}` : "Expiry not read",
  ]
    .filter(Boolean)
    .join(" · ");
}

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

type Supabase = Awaited<ReturnType<typeof requireAuthContext>>["supabase"];

async function appendHistory(
  supabase: Supabase,
  row: {
    agencyId: string;
    subject: LicenceSubject;
    profileId: string | null;
    source: "document_read" | "typed" | "document_removed";
    before: Snapshot;
    after: Snapshot;
    by: string;
  },
): Promise<void> {
  const { error } = await supabase.from("licence_history").insert({
    agency_id: row.agencyId,
    subject_kind: row.subject === "person" ? "profile" : "corporation",
    profile_id: row.profileId,
    source: row.source,
    before: row.before,
    after: row.after,
    changed_by: row.by,
  });
  // Not fatal: the record itself has already changed, and refusing to report
  // that because the trail failed would be the worse outcome. Logged so a
  // missing table (migration 0051 not yet run) is visible.
  if (error) console.error("licence_history insert failed", { error, subject: row.subject });
}

function personSnapshot(p: Profile): Snapshot {
  return {
    holderName: p.full_name ?? null,
    licenceType: p.licence_type,
    licenceNumber: p.licence_number,
    expiry: p.licence_expiry,
    documentPath: p.licence_document_path,
    documentFileName: p.licence_document_file_name,
  };
}

function corporationSnapshot(a: Agency): Snapshot {
  return {
    holderName: a.corporation_licence_holder,
    licenceType: null,
    licenceNumber: a.corporation_licence_number,
    expiry: a.corporation_licence_expiry,
    documentPath: a.corporation_licence_document_path ?? null,
    documentFileName: a.corporation_licence_document_file_name ?? null,
  };
}

function savedMessage(state: LicenceReadState, expired: boolean): Pick<LicenceReadResult, "outcome" | "message"> {
  const gaps = state.missing.map((f) => LICENCE_FIELD_LABELS[f]);
  const parts: string[] = [];
  parts.push(gaps.length === 0 ? "Read from the document and saved." : "Read from the document and saved what was clear.");
  if (gaps.length > 0) parts.push(`Couldn't read the ${joinAnd(gaps)}. Please add ${gaps.length === 1 ? "it" : "them"} below.`);
  if (expired) parts.push("The expiry date on it has already passed.");
  return { outcome: gaps.length === 0 ? "saved" : "saved_with_gaps", message: parts.join(" ") };
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Removes a file just uploaded that is not going on the record, and says
 * whether it went.
 *
 * Checked, not assumed (review of 10 Oct 2026). A delete the database refuses
 * (an agent before 0060 has run) comes back empty, not as an error, so the
 * other person's licence stayed in storage while the message said nothing was
 * kept. Same check as the refused ID document in actions/compliance.ts.
 */
async function discardUpload(supabase: Supabase, path: string): Promise<boolean> {
  const { data: removed, error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
  const deleted = !error && (removed?.length ?? 0) > 0;
  if (!deleted) {
    // The folder only, never the file name, which often carries a name.
    console.error("refused licence upload not deleted:", path.split("/").slice(0, 3).join("/"), error?.message);
  }
  return deleted;
}

/** Added to a refusal when the file it refused is still in storage. */
const NOT_DELETED = " RealComply couldn't delete the copy just now, so it is still stored, though not on this record.";

// ── A person's licence or certificate ───────────────────────────────────────

async function loadPerson(supabase: Supabase, profileId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", profileId).maybeSingle();
  return (data as Profile | null) ?? null;
}

/**
 * Reads a person's licence off a document and saves what it says.
 *
 * `fresh` is true for a file just uploaded (which is discarded if it turns out
 * to be the wrong document), false for the one-off read of a document already
 * on the record (which is left where it is).
 */
async function readPersonLicence(
  supabase: Supabase,
  actor: Profile,
  subject: Profile,
  path: string,
  fileName: string,
  fresh: boolean,
): Promise<LicenceReadResult> {
  const before = personSnapshot(subject);
  const previous = parseReadState(subject.licence_read);
  const now = new Date();
  const at = now.toISOString();

  const { error: readError, raw } = await extractLicenceDocument(path, fileName);

  if (readError) {
    // Nothing was read. The document still goes on the record (it is the
    // evidence), the values already there are left alone rather than blanked
    // on the strength of a failed read, and the card asks for whatever is
    // still empty.
    const state: LicenceReadState = {
      ...(previous ?? emptyState()),
      lastRead: { status: "could_not_read", at, by: actor.id, fileName, nameOnDocument: null, nameChecked: false },
      missing: (["licenceType", "licenceNumber", "expiry"] as const).filter((f) => !before[f]),
    };
    const { error } = await supabase
      .from("profiles")
      .update({ licence_document_path: path, licence_document_file_name: fileName, licence_read: state })
      .eq("id", subject.id);
    if (error) return { error: "Couldn't save the document. Try again." };
    if (fresh) {
      await appendHistory(supabase, {
        agencyId: subject.agency_id, subject: "person", profileId: subject.id, source: "document_read",
        before, after: { ...before, documentPath: path, documentFileName: fileName }, by: actor.id,
      });
    }
    revalidatePath("/dashboard/registers");
    return { error: null, outcome: "could_not_read", message: readError };
  }

  const decision = decideLicenceRead({
    read: sanitiseLicenceRead(raw),
    subject: "person",
    expectedNames: subject.full_name ? [subject.full_name] : [],
    previous,
    by: actor.id,
    at,
    fileName,
    today: now,
  });

  if (decision.kind === "name_mismatch") {
    // REVERSAL (Adam, 15 Oct 2026): was (2 Oct licence-read brief, rule 4, kept strict in #45): a holder name mismatch on a personal licence saves nothing. Now: show what was read and ask the user to confirm it's this person's licence; Yes saves, No removes the file.
    //
    // Nothing is saved while the question waits, and the file stays where it
    // is until the answer: "Yes" (confirmLicenceName) saves this read, "No"
    // (rejectLicenceName) removes the file. The read goes with the question,
    // signed, so what is saved is exactly what was shown.
    const secret = pendingSecret();
    const personName = subject.full_name ?? subject.email;
    if (secret) {
      const read = sanitiseLicenceRead(raw);
      const token = signPendingRead<LicenceDocumentRead>(
        {
          v: 1,
          kind: "licence",
          profileId: subject.id,
          askedBy: actor.id,
          path,
          fileName,
          fresh,
          nameOnDocument: decision.nameOnDocument,
          read,
          issuedAt: now.getTime(),
        },
        secret,
      );
      return {
        error: null,
        outcome: "confirm_name",
        question: {
          token,
          nameOnDocument: decision.nameOnDocument,
          personName,
          firstName: firstName(personName),
          summary: readSummary(read),
        },
      };
    }
    // No way to hold the read: say so, and leave things as they were.
    const kept = fresh && !(await discardUpload(supabase, path));
    return {
      error: null,
      outcome: "name_mismatch",
      message: `The name on this document is ${decision.nameOnDocument}, not ${personName}. Nothing was saved. Try again in a moment.${kept ? NOT_DELETED : ""}`,
    };
  }

  if (decision.kind !== "save") {
    // Not a licence at all. Nothing is saved, and a file just uploaded goes
    // straight back out of Storage: it has no business on this record.
    //
    // Nothing means nothing (10 Oct 2026). The refusal is not written to
    // licence_read; the warning is the message returned below, shown once in
    // the browser that uploaded it.
    const kept = fresh && !(await discardUpload(supabase, path));
    revalidatePath("/dashboard/registers");
    return {
      error: null,
      outcome: "not_a_licence",
      message: `This doesn't look like a licence or certificate of registration. Nothing was saved.${kept ? NOT_DELETED : ""}`,
    };
  }

  return savePersonRead(supabase, actor, subject, path, fileName, decision, null);
}

/** Saves a read that is going on the record: the values, the document, and a line in the history. */
async function savePersonRead(
  supabase: Supabase,
  actor: Profile,
  subject: Profile,
  path: string,
  fileName: string,
  decision: Extract<ReturnType<typeof decideLicenceRead>, { kind: "save" }>,
  confirmed: { nameOnDocument: string; at: string } | null,
): Promise<LicenceReadResult> {
  const before = personSnapshot(subject);
  const v = decision.values;
  const after: Snapshot = {
    holderName: before.holderName,
    licenceType: v.licenceType,
    licenceNumber: v.licenceNumber,
    expiry: v.expiry,
    documentPath: path,
    documentFileName: fileName,
    // Who said a licence in another name was this person's, and when.
    ...(confirmed
      ? { nameOnDocument: confirmed.nameOnDocument, nameConfirmedBy: actor.id, nameConfirmedAt: confirmed.at }
      : {}),
  };

  // The superseded document is NOT removed from Storage. It and the expiry it
  // carried stay findable through licence_history, which is what makes a
  // renewal traceable rather than an overwrite.
  const { error } = await supabase
    .from("profiles")
    .update({
      licence_type: v.licenceType,
      licence_number: v.licenceNumber,
      licence_expiry: v.expiry,
      licence_document_path: path,
      licence_document_file_name: fileName,
      licence_read: decision.state,
    })
    .eq("id", subject.id);
  if (error) return { error: "Couldn't save what was read. Try again." };

  await appendHistory(supabase, {
    agencyId: subject.agency_id, subject: "person", profileId: subject.id, source: "document_read",
    before, after, by: actor.id,
  });

  revalidatePath("/dashboard/registers");
  return { error: null, ...savedMessage(decision.state, decision.expired) };
}

/**
 * The held read, checked: signed by this server, asked of the person
 * answering, not too old, and still about this person's licence folder. Who
 * may answer is who could have asked: the person or their licensee in charge
 * for an upload; the licensee for "Read from document".
 */
async function heldLicenceRead(token: string) {
  const ctx = await requireAuthContext();
  const { supabase, profile, access } = ctx;
  const secret = pendingSecret();
  if (!secret) return { problem: pendingReadProblem("invalid", "licence") } as const;
  const v = verifyPendingRead<LicenceDocumentRead>(token, secret, {
    kind: "licence",
    answeredBy: profile.id,
    now: Date.now(),
  });
  if (!v.ok) return { problem: pendingReadProblem(v.reason, "licence") } as const;
  const p = v.pending;
  if (p.profileId !== profile.id && !(profile.is_licensee_in_charge || access.isOfficeManager)) {
    return { problem: "Only the licensee in charge can answer for someone else's licence." } as const;
  }
  if (!p.fresh && !access.runsOffice) return { problem: "Only the licensee in charge can do this." } as const;
  const subject = await loadPerson(supabase, p.profileId);
  if (!subject) return { problem: "Couldn't find that person." } as const;
  if (!isInFolder(p.path, `${subject.agency_id}/_licences/${subject.id}/`)) {
    return { problem: pendingReadProblem("invalid", "licence") } as const;
  }
  // "Read from document" asked about the file on the record. If that has
  // changed since, the answer is about a file that is no longer there.
  if (!p.fresh && subject.licence_document_path !== p.path) {
    return { problem: "The document on file has changed since. Read it again." } as const;
  }
  return { supabase, profile: profile as Profile, subject, pending: p } as const;
}

/** "Yes, it's Jo's": saves the read as shown, and records the name on the licence and who confirmed it. */
export async function confirmLicenceName(token: string): Promise<LicenceReadResult> {
  const held = await heldLicenceRead(token);
  if ("problem" in held) return { error: held.problem ?? "Couldn't save that." };
  const { supabase, profile, subject, pending } = held;
  const now = new Date();
  const at = now.toISOString();
  const decision = decideLicenceRead({
    read: pending.read,
    subject: "person",
    expectedNames: subject.full_name ? [subject.full_name] : [],
    previous: parseReadState(subject.licence_read),
    by: profile.id,
    at,
    fileName: pending.fileName,
    today: now,
    nameConfirmedAs: subject.full_name ?? subject.email,
  });
  if (decision.kind !== "save") return { error: "Couldn't save that. Upload the licence again." };
  return savePersonRead(supabase, profile, subject, pending.path, pending.fileName, decision, {
    nameOnDocument: pending.nameOnDocument,
    at,
  });
}

/** "No, wrong person": removes the file and saves nothing. */
export async function rejectLicenceName(token: string): Promise<LicenceReadResult> {
  const held = await heldLicenceRead(token);
  if ("problem" in held) return { error: held.problem ?? "Couldn't do that." };
  const { supabase, profile, subject, pending } = held;
  const own =
    subject.licence_type === "certificate_of_registration" ? "certificate of registration" : "licence";

  if (pending.fresh) {
    // Never the document already on the record: only the file just uploaded.
    const kept = subject.licence_document_path !== pending.path && !(await discardUpload(supabase, pending.path));
    return {
      error: null,
      outcome: "removed",
      message: `The file was removed and nothing was saved. Upload ${possessive(firstName(subject.full_name ?? subject.email))} own ${own}.${kept ? NOT_DELETED : ""}`,
    };
  }

  // "Read from document" on a file already on the record: it comes off the
  // record, and out of Storage, since it is someone else's licence. Any
  // earlier "Yes" about it goes with it.
  const before = personSnapshot(subject);
  const { error } = await supabase
    .from("profiles")
    .update({
      licence_document_path: null,
      licence_document_file_name: null,
      licence_read: withoutNameConfirmation(parseReadState(subject.licence_read)),
    })
    .eq("id", subject.id);
  if (error) return { error: "Couldn't remove the file. Try again." };
  await appendHistory(supabase, {
    agencyId: subject.agency_id, subject: "person", profileId: subject.id, source: "document_removed",
    before, after: { ...before, documentPath: null, documentFileName: null }, by: profile.id,
  });
  const kept = !(await discardUpload(supabase, pending.path));
  revalidatePath("/dashboard/registers");
  return {
    error: null,
    outcome: "removed",
    message: `The file was removed and nothing was saved. Upload ${possessive(firstName(subject.full_name ?? subject.email))} own ${own}.${kept ? NOT_DELETED : ""}`,
  };
}

/** Called once the browser has put the file in Storage. */
export async function attachLicenceDocument(
  profileId: string,
  path: string,
  fileName: string,
): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (profile.id !== profileId && !(profile.is_licensee_in_charge || access.isOfficeManager)) {
    return { error: "Only the licensee in charge can attach someone else's licence document." };
  }
  const subject = await loadPerson(supabase, profileId);
  if (!subject) return { error: "Couldn't find that person." };
  // Never an empty document on the record (19 Oct 2026); nothing is saved.
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };
  return readPersonLicence(supabase, profile as Profile, subject, path, fileName, true);
}

/**
 * The one-off read for a record that already has a document but no details.
 * Three such records existed in production when this was written. The
 * licensee's to run; it never discards the file it reads.
 */
export async function readLicenceFromDocument(profileId: string): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice || (profile.id !== profileId && !(profile.is_licensee_in_charge || access.isOfficeManager))) {
    return { error: "Only the licensee in charge can do this." };
  }
  const subject = await loadPerson(supabase, profileId);
  if (!subject?.licence_document_path) return { error: "There's no document on file to read." };
  return readPersonLicence(
    supabase,
    profile as Profile,
    subject,
    subject.licence_document_path,
    subject.licence_document_file_name ?? "document",
    false,
  );
}

// Typed corrections. Anyone can maintain their own licence record; the
// licensee can also fix a colleague's.
export async function updateLicence(profileId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();

  if (profile.id !== profileId && !(profile.is_licensee_in_charge || access.isOfficeManager)) {
    return { error: "Only the licensee in charge can update someone else's licence details." };
  }

  const subject = await loadPerson(supabase, profileId);
  if (!subject) return { error: "Couldn't find that person." };

  const licenceType = str(formData, "licenceType") as LicenceType | null;
  const licenceNumber = str(formData, "licenceNumber");
  const licenceExpiry = str(formData, "licenceExpiry");

  // Every type of licence held, ticked (Adam, 14 Oct 2026), set here and only
  // here, beside the licence (as the single category of practice was, 18 Aug
  // 2026). Sent only by the full edit form.
  const types = formData.get("licenceCategoriesShown") === "1"
    ? { licence_categories: cleanLicenceCategories(formData.getAll("licenceCategories")) }
    : {};

  const before = personSnapshot(subject);
  const after: Snapshot = { ...before, licenceType, licenceNumber, expiry: licenceExpiry };
  const state = recordTypedChanges(
    parseReadState(subject.licence_read), "person", before, after, profile.id, new Date().toISOString(),
  );

  const { error } = await supabase
    .from("profiles")
    .update({
      licence_type: licenceType,
      licence_number: licenceNumber,
      licence_expiry: licenceExpiry,
      ...types,
      licence_read: state,
    })
    .eq("id", profileId);

  if (error) return { error: "Couldn't save licence details. Try again." };

  if (before.licenceType !== after.licenceType || before.licenceNumber !== after.licenceNumber || before.expiry !== after.expiry) {
    await appendHistory(supabase, {
      agencyId: subject.agency_id, subject: "person", profileId, source: "typed", before, after, by: profile.id,
    });
  }

  revalidatePath("/dashboard/registers");
  return { error: null };
}

/**
 * Detaches the document. The file itself stays in Storage and the history
 * row records it: a licence document is a record the agency may be asked
 * for, and detaching it from the card is not a reason to destroy it.
 */
export async function removeLicenceDocument(profileId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (profile.id !== profileId && !profile.is_licensee_in_charge) return;

  const subject = await loadPerson(supabase, profileId);
  if (!subject?.licence_document_path) return;
  const before = personSnapshot(subject);

  // The name confirmation was about this file, so it goes with it.
  await supabase
    .from("profiles")
    .update({
      licence_document_path: null,
      licence_document_file_name: null,
      licence_read: withoutNameConfirmation(parseReadState(subject.licence_read)),
    })
    .eq("id", profileId);

  await appendHistory(supabase, {
    agencyId: subject.agency_id, subject: "person", profileId, source: "document_removed",
    before, after: { ...before, documentPath: null, documentFileName: null }, by: profile.id,
  });

  revalidatePath("/dashboard/registers");
}

// ── The corporation licence ─────────────────────────────────────────────────
//
// Same reading and the same rules, against the agency row. Licensee only,
// matching how the corporation licence was always edited.

async function loadAgency(supabase: Supabase, agencyId: string): Promise<Agency | null> {
  const { data } = await supabase.from("agencies").select("*").eq("id", agencyId).maybeSingle();
  return (data as Agency | null) ?? null;
}

async function readCorporationLicence(
  supabase: Supabase,
  actor: Profile,
  agency: Agency,
  path: string,
  fileName: string,
  fresh: boolean,
): Promise<LicenceReadResult> {
  const before = corporationSnapshot(agency);
  const previous = parseReadState(agency.corporation_licence_read);
  const now = new Date();
  const at = now.toISOString();

  const { error: readError, raw } = await extractLicenceDocument(path, fileName);

  if (readError) {
    const state: LicenceReadState = {
      ...(previous ? withoutEntityCheck(previous) : emptyState()),
      lastRead: { status: "could_not_read", at, by: actor.id, fileName, nameOnDocument: null, nameChecked: false },
      missing: (["holderName", "licenceNumber", "expiry"] as const).filter((f) => !before[f]),
    };
    const { error } = await supabase
      .from("agencies")
      .update({
        corporation_licence_document_path: path,
        corporation_licence_document_file_name: fileName,
        corporation_licence_read: state,
      })
      .eq("id", agency.id);
    if (error) return { error: "Couldn't save the document. Try again." };
    if (fresh) {
      await appendHistory(supabase, {
        agencyId: agency.id, subject: "corporation", profileId: null, source: "document_read",
        before, after: { ...before, documentPath: path, documentFileName: fileName }, by: actor.id,
      });
    }
    revalidatePath("/dashboard/registers");
    return { error: null, outcome: "could_not_read", message: readError };
  }

  // CHANGE (Adam, 14 Oct 2026): was: corporation licence holder matched against the office name and refused on mismatch. Now: matched against the licensed entity name; a mismatch asks to update it, never refuses. Personal licences keep the strict name check.
  //
  // (15 Oct 2026: a person's licence no longer refuses on the name either; it
  // asks "Is this [person]'s licence?" See readPersonLicence. This check is
  // unchanged.)
  //
  // So no names go in here: the read never refuses a corporation licence on
  // its name. The holder is compared with the licensed entity name below,
  // after the licence is saved.
  const decision = decideLicenceRead({
    read: sanitiseLicenceRead(raw),
    subject: "corporation",
    expectedNames: [],
    previous: previous ? withoutEntityCheck(previous) : null,
    by: actor.id,
    at,
    fileName,
    today: now,
  });

  if (decision.kind !== "save") {
    // Saves nothing, the same as a person's licence above.
    const kept = fresh && !(await discardUpload(supabase, path));
    revalidatePath("/dashboard/registers");
    return decision.kind === "name_mismatch"
      ? {
          error: null,
          outcome: "name_mismatch",
          message: `The holder on this document is ${decision.nameOnDocument}, which doesn't match ${agency.corporation_licence_holder ?? agency.name}. Nothing was saved. Check it's this agency's corporation licence.${kept ? NOT_DELETED : ""}`,
        }
      : {
          error: null,
          outcome: "not_a_licence",
          message: `This doesn't look like a corporation licence. Nothing was saved.${kept ? NOT_DELETED : ""}`,
        };
  }

  const v = decision.values;
  const after: Snapshot = {
    holderName: v.holderName,
    licenceType: null,
    licenceNumber: v.licenceNumber,
    expiry: v.expiry,
    documentPath: path,
    documentFileName: fileName,
  };

  // The holder against the licensed entity name, loosely (case, punctuation,
  // spacing, "Pty Ltd" or "Pty. Limited"). Blank or different: the licence is
  // saved as read, and the card asks "Use [holder] as your licensed entity
  // name?" until it is answered. A match asks nothing.
  const ask = asksAboutEntityName(v.holderName, agency.licensed_entity_name);
  const state: LicenceReadState = ask
    ? {
        ...decision.state,
        entityCheck: {
          holderName: v.holderName as string,
          path,
          at,
          by: actor.id,
          before: {
            holderName: before.holderName,
            licenceNumber: before.licenceNumber,
            expiry: before.expiry,
            documentPath: before.documentPath,
            documentFileName: before.documentFileName,
          },
          previousRead: previous ? withoutEntityCheck(previous) : null,
        },
      }
    : decision.state;

  const { error } = await supabase
    .from("agencies")
    .update({
      corporation_licence_holder: v.holderName,
      corporation_licence_number: v.licenceNumber,
      corporation_licence_expiry: v.expiry,
      corporation_licence_document_path: path,
      corporation_licence_document_file_name: fileName,
      corporation_licence_read: state,
    })
    .eq("id", agency.id);
  if (error) return { error: "Couldn't save what was read. Try again." };

  await appendHistory(supabase, {
    agencyId: agency.id, subject: "corporation", profileId: null, source: "document_read", before, after, by: actor.id,
  });

  revalidatePath("/dashboard/registers");
  return { error: null, ...savedMessage(decision.state, decision.expired) };
}

function withoutEntityCheck(state: LicenceReadState): Omit<LicenceReadState, "entityCheck"> {
  return { lastRead: state.lastRead, missing: state.missing, fields: state.fields };
}

/** The question waiting on this agency's corporation licence, if it is still about the document on file. */
async function pendingEntityCheck(): Promise<
  | { error: string }
  | { error: null; supabase: Supabase; actor: Profile; agency: Agency; check: EntityCheck; state: LicenceReadState }
> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: "Only the licensee in charge can update the corporation licence." };
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };
  const state = parseReadState(agency.corporation_licence_read);
  const check = state?.entityCheck ?? null;
  if (!state || !check || check.path !== agency.corporation_licence_document_path) {
    return { error: "There's nothing waiting for an answer. Refresh the page." };
  }
  return { error: null, supabase, actor: profile as Profile, agency, check, state };
}

/**
 * "Yes, use it": the holder on the corporation licence becomes the office's
 * licensed entity name, shown in Office profile as read from the licence.
 */
export async function acceptLicenceHolderAsEntityName(): Promise<ActionState> {
  const found = await pendingEntityCheck();
  if (found.error !== null) return { error: found.error };
  const { supabase, agency, check, state } = found;

  const { error } = await supabase.rpc("set_agency_licensed_entity_name", {
    p_name: check.holderName,
    p_via: "corporation_licence",
  });
  if (error) {
    console.error("licensed entity name from licence failed", error.message);
    return { error: "Couldn't save the licensed entity name. Try again." };
  }
  await supabase
    .from("agencies")
    .update({ corporation_licence_read: withoutEntityCheck(state) })
    .eq("id", agency.id);

  revalidatePath("/dashboard/registers");
  revalidatePath("/dashboard/profile");
  return { error: null };
}

/**
 * "No, wrong licence": the upload is removed and nothing it said is kept. The
 * record goes back to what it held before, and the file is deleted.
 */
export async function rejectCorporationLicenceUpload(): Promise<ActionState> {
  const found = await pendingEntityCheck();
  if (found.error !== null) return { error: found.error };
  const { supabase, actor, agency, check } = found;
  const was = check.before;
  const current = corporationSnapshot(agency);

  const { error } = await supabase
    .from("agencies")
    .update({
      corporation_licence_holder: was.holderName,
      corporation_licence_number: was.licenceNumber,
      corporation_licence_expiry: was.expiry,
      corporation_licence_document_path: was.documentPath,
      corporation_licence_document_file_name: was.documentFileName,
      corporation_licence_read: check.previousRead ?? emptyState(),
    })
    .eq("id", agency.id);
  if (error) return { error: "Couldn't remove the upload. Try again." };

  // A re-read of the document already on file has nothing new to delete.
  const kept = check.path !== was.documentPath && !(await discardUpload(supabase, check.path));

  await appendHistory(supabase, {
    agencyId: agency.id, subject: "corporation", profileId: null, source: "document_removed",
    before: current,
    after: { ...current, ...was, licenceType: null },
    by: actor.id,
  });

  revalidatePath("/dashboard/registers");
  return { error: kept ? `The upload was removed from the record.${NOT_DELETED}` : null };
}

export async function attachCorporationLicenceDocument(path: string, fileName: string): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice) {
    return { error: "Only the licensee in charge can update the corporation licence." };
  }
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };
  // Never an empty document on the record (19 Oct 2026); nothing is saved.
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };
  return readCorporationLicence(supabase, profile as Profile, agency, path, fileName, true);
}

export async function readCorporationLicenceFromDocument(): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice) return { error: "Only the licensee in charge can do this." };
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency?.corporation_licence_document_path) return { error: "There's no document on file to read." };
  return readCorporationLicence(
    supabase,
    profile as Profile,
    agency,
    agency.corporation_licence_document_path,
    agency.corporation_licence_document_file_name ?? "document",
    false,
  );
}

export async function updateCorporationLicence(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();

  // Same gate as the insurance policies: an agency-level record that an agent
  // should be able to read but not rewrite.
  if (!access.runsOffice) {
    return { error: "Only the licensee in charge can update the corporation licence." };
  }

  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };

  const before = corporationSnapshot(agency);
  const after: Snapshot = {
    ...before,
    holderName: str(formData, "holder"),
    licenceNumber: str(formData, "licenceNumber"),
    expiry: str(formData, "expiry"),
  };
  const state = recordTypedChanges(
    parseReadState(agency.corporation_licence_read), "corporation", before, after, profile.id, new Date().toISOString(),
  );

  const { error } = await supabase
    .from("agencies")
    .update({
      corporation_licence_holder: after.holderName,
      corporation_licence_number: after.licenceNumber,
      corporation_licence_expiry: after.expiry,
      corporation_licence_read: state,
    })
    .eq("id", profile.agency_id);

  if (error) return { error: "Couldn't save the corporation licence. Try again." };

  if (before.holderName !== after.holderName || before.licenceNumber !== after.licenceNumber || before.expiry !== after.expiry) {
    await appendHistory(supabase, {
      agencyId: agency.id, subject: "corporation", profileId: null, source: "typed", before, after, by: profile.id,
    });
  }

  revalidatePath("/dashboard/registers");
  return { error: null };
}

export async function removeCorporationLicenceDocument(): Promise<void> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return;
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency?.corporation_licence_document_path) return;
  const before = corporationSnapshot(agency);

  await supabase
    .from("agencies")
    .update({ corporation_licence_document_path: null, corporation_licence_document_file_name: null })
    .eq("id", agency.id);

  await appendHistory(supabase, {
    agencyId: agency.id, subject: "corporation", profileId: null, source: "document_removed",
    before, after: { ...before, documentPath: null, documentFileName: null }, by: profile.id,
  });
  revalidatePath("/dashboard/registers");
}

// ── Filling in only what the read could not ─────────────────────────────────
//
// When a read leaves a field empty, the card asks for that field and nothing
// else. This writes only the fields the form sent, so answering "what's the
// expiry date?" can never blank the number that was read correctly.
export type GapTarget = { kind: "person"; profileId: string } | { kind: "corporation" };

export async function fillLicenceGaps(target: GapTarget, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  const at = new Date().toISOString();

  const expiry = formData.has("expiry") ? str(formData, "expiry") : undefined;
  if (expiry !== undefined && expiry !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    return { error: "Enter the expiry date as a date." };
  }
  const number = formData.has("licenceNumber") ? str(formData, "licenceNumber") : undefined;

  if (target.kind === "person") {
    if (profile.id !== target.profileId && !(profile.is_licensee_in_charge || access.isOfficeManager)) {
      return { error: "Only the licensee in charge can update someone else's licence details." };
    }
    const subject = await loadPerson(supabase, target.profileId);
    if (!subject) return { error: "Couldn't find that person." };
    const type = formData.has("licenceType") ? (str(formData, "licenceType") as LicenceType | null) : undefined;

    const before = personSnapshot(subject);
    const after: Snapshot = {
      ...before,
      ...(type !== undefined ? { licenceType: type } : {}),
      ...(number !== undefined ? { licenceNumber: number } : {}),
      ...(expiry !== undefined ? { expiry } : {}),
    };
    const state = recordTypedChanges(parseReadState(subject.licence_read), "person", before, after, profile.id, at);
    const { error } = await supabase
      .from("profiles")
      .update({
        licence_type: after.licenceType,
        licence_number: after.licenceNumber,
        licence_expiry: after.expiry,
        licence_read: state,
      })
      .eq("id", subject.id);
    if (error) return { error: "Couldn't save that. Try again." };
    await appendHistory(supabase, {
      agencyId: subject.agency_id, subject: "person", profileId: subject.id, source: "typed", before, after, by: profile.id,
    });
  } else {
    if (!access.runsOffice) {
      return { error: "Only the licensee in charge can update the corporation licence." };
    }
    const agency = await loadAgency(supabase, profile.agency_id);
    if (!agency) return { error: "Couldn't find the agency." };
    const holder = formData.has("holder") ? str(formData, "holder") : undefined;

    const before = corporationSnapshot(agency);
    const after: Snapshot = {
      ...before,
      ...(holder !== undefined ? { holderName: holder } : {}),
      ...(number !== undefined ? { licenceNumber: number } : {}),
      ...(expiry !== undefined ? { expiry } : {}),
    };
    const state = recordTypedChanges(
      parseReadState(agency.corporation_licence_read), "corporation", before, after, profile.id, at,
    );
    const { error } = await supabase
      .from("agencies")
      .update({
        corporation_licence_holder: after.holderName,
        corporation_licence_number: after.licenceNumber,
        corporation_licence_expiry: after.expiry,
        corporation_licence_read: state,
      })
      .eq("id", agency.id);
    if (error) return { error: "Couldn't save that. Try again." };
    await appendHistory(supabase, {
      agencyId: agency.id, subject: "corporation", profileId: null, source: "typed", before, after, by: profile.id,
    });
  }

  revalidatePath("/dashboard/registers");
  return { error: null };
}

// ── A test reminder ─────────────────────────────────────────────────────────
//
// Proves a reminder reaches an agent, not only the licensee. The licensee
// picks a team member; one clearly labelled test goes to that person (the
// holder's version) and one to the licensee (the licensee's version). Nothing
// is written to licence_reminders, so the real schedule is untouched.
export async function sendTestLicenceReminder(
  memberId: string,
): Promise<{ error: string | null; sentTo?: string[]; failedTo?: string[] }> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice) {
    return { error: "Only the licensee in charge can send a test reminder." };
  }

  const member = await loadPerson(supabase, memberId);
  if (!member || member.agency_id !== profile.agency_id || member.archived_at) {
    return { error: "Choose someone currently in the office." };
  }
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };

  const result = await sendLicenceReminderTest({ member, licensee: profile as Profile, agency });
  if (result.sentTo.length === 0) {
    return { error: "The test didn't send. The email provider refused it; check the email settings.", failedTo: result.failedTo };
  }
  return { error: null, sentTo: result.sentTo, failedTo: result.failedTo };
}
