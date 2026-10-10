"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { extractLicenceDocument } from "@/lib/actions/extraction";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import {
  decideLicenceRead,
  emptyState,
  parseReadState,
  recordTypedChanges,
  sanitiseLicenceRead,
  LICENCE_FIELD_LABELS,
  type LicenceReadState,
  type LicenceSubject,
  type LicenceValues,
} from "@/lib/licence-read";
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
  outcome?: "saved" | "saved_with_gaps" | "name_mismatch" | "not_a_licence" | "could_not_read";
  message?: string;
};

type Snapshot = LicenceValues & { documentPath: string | null; documentFileName: string | null };

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

  if (decision.kind !== "save") {
    // The wrong person's licence, or not a licence at all. Nothing is saved.
    // A file just uploaded goes straight back out of Storage: it is somebody
    // else's personal document and has no business sitting on this record.
    //
    // Nothing means nothing (10 Oct 2026). The refusal used to be written to
    // licence_read, which kept the other person's name in this person's
    // record. The warning is the message returned below, shown once in the
    // browser that uploaded it.
    const kept = fresh && !(await discardUpload(supabase, path));
    revalidatePath("/dashboard/registers");
    const who = subject.full_name ?? subject.email;
    return decision.kind === "name_mismatch"
      ? {
          error: null,
          outcome: "name_mismatch",
          message: `The name on this document is ${decision.nameOnDocument}, which doesn't match ${who}. Nothing was saved. Check it's the right person's licence.${kept ? NOT_DELETED : ""}`,
        }
      : {
          error: null,
          outcome: "not_a_licence",
          message: `This doesn't look like a licence or certificate of registration. Nothing was saved.${kept ? NOT_DELETED : ""}`,
        };
  }

  const v = decision.values;
  const after: Snapshot = {
    holderName: before.holderName,
    licenceType: v.licenceType,
    licenceNumber: v.licenceNumber,
    expiry: v.expiry,
    documentPath: path,
    documentFileName: fileName,
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
      // An assistant agent has no category of practice (see updateLicence).
      ...(v.licenceType === "certificate_of_registration" ? { cpd_practice_category: null } : {}),
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

/** Called once the browser has put the file in Storage. */
export async function attachLicenceDocument(
  profileId: string,
  path: string,
  fileName: string,
): Promise<LicenceReadResult> {
  const { supabase, profile } = await requireAuthContext();
  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can attach someone else's licence document." };
  }
  const subject = await loadPerson(supabase, profileId);
  if (!subject) return { error: "Couldn't find that person." };
  return readPersonLicence(supabase, profile as Profile, subject, path, fileName, true);
}

/**
 * The one-off read for a record that already has a document but no details.
 * Three such records existed in production when this was written. The
 * licensee's to run; it never discards the file it reads.
 */
export async function readLicenceFromDocument(profileId: string): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee || (profile.id !== profileId && !profile.is_licensee_in_charge)) {
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
  const { supabase, profile } = await requireAuthContext();

  if (profile.id !== profileId && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can update someone else's licence details." };
  }

  const subject = await loadPerson(supabase, profileId);
  if (!subject) return { error: "Couldn't find that person." };

  const licenceType = str(formData, "licenceType") as LicenceType | null;
  const licenceNumber = str(formData, "licenceNumber");
  const licenceExpiry = str(formData, "licenceExpiry");

  // Category of practice is set here and only here (Adam, 18 Aug 2026). It
  // decides the CPD hours, changes about as often as a licence does, and was
  // previously being asked on the CPD screen and the training plan as well.
  // An assistant agent has no category: their requirement is units.
  const cpdPracticeCategory =
    licenceType === "certificate_of_registration" ? null : str(formData, "cpdPracticeCategory");

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
      cpd_practice_category: cpdPracticeCategory,
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

  await supabase
    .from("profiles")
    .update({ licence_document_path: null, licence_document_file_name: null })
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
      ...(previous ?? emptyState()),
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

  const decision = decideLicenceRead({
    read: sanitiseLicenceRead(raw),
    subject: "corporation",
    expectedNames: [agency.corporation_licence_holder, agency.name].filter((n): n is string => Boolean(n)),
    previous,
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

  const { error } = await supabase
    .from("agencies")
    .update({
      corporation_licence_holder: v.holderName,
      corporation_licence_number: v.licenceNumber,
      corporation_licence_expiry: v.expiry,
      corporation_licence_document_path: path,
      corporation_licence_document_file_name: fileName,
      corporation_licence_read: decision.state,
    })
    .eq("id", agency.id);
  if (error) return { error: "Couldn't save what was read. Try again." };

  await appendHistory(supabase, {
    agencyId: agency.id, subject: "corporation", profileId: null, source: "document_read", before, after, by: actor.id,
  });

  revalidatePath("/dashboard/registers");
  return { error: null, ...savedMessage(decision.state, decision.expired) };
}

export async function attachCorporationLicenceDocument(path: string, fileName: string): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) {
    return { error: "Only the licensee in charge can update the corporation licence." };
  }
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };
  return readCorporationLicence(supabase, profile as Profile, agency, path, fileName, true);
}

export async function readCorporationLicenceFromDocument(): Promise<LicenceReadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can do this." };
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
  if (!access.actsAsLicensee) {
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
    if (profile.id !== target.profileId && !profile.is_licensee_in_charge) {
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
        ...(after.licenceType === "certificate_of_registration" ? { cpd_practice_category: null } : {}),
      })
      .eq("id", subject.id);
    if (error) return { error: "Couldn't save that. Try again." };
    await appendHistory(supabase, {
      agencyId: subject.agency_id, subject: "person", profileId: subject.id, source: "typed", before, after, by: profile.id,
    });
  } else {
    if (!access.actsAsLicensee) {
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
  if (!access.actsAsLicensee) {
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
