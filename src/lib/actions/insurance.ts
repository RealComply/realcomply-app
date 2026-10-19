"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { extractInsuranceCertificate } from "@/lib/actions/extraction";
import { EVIDENCE_BUCKET, insuranceFolder, isInFolder, otherInsuranceFolder, storedFileProblem } from "@/lib/storage/evidence";
import { formatAuDate } from "@/lib/format-date";
import {
  INSURANCE_FIELDS,
  OTHER_INSURANCE_NAME_MAX,
  addedMessage,
  couldNotReadState,
  decideInsuranceRead,
  isOtherInsuranceKind,
  notACertificateMessage,
  otherInsuranceTitle,
  parseInsuranceRead,
  recordTypedInsurance,
  removedCertificateState,
  sanitiseInsuranceRead,
  savedMessage,
  validIsoDate,
  wrongCoverMessage,
  type AnyPolicy,
  type InsuranceField,
  type InsuranceReadDecision,
  type InsuranceReadState,
  type InsuranceValues,
} from "@/lib/insurance-read";
import type { Agency, InsurancePolicy, InsurancePolicyType, OtherInsuranceKind } from "@/lib/types";

// The Insurance register's three policies: the certificate of currency or
// schedule uploaded and read, details typed by hand, and the certificate taken
// off (0076; Trent's ask, mockup approved by Adam, 15 Oct 2026).
//
// Every write to a policy goes through this file and does the same two
// things: change the policy, and say how (changeSource in its read state).
// The database writes the policy as it was to insurance_history on every
// change, so last year's certificate and expiry are never overwritten
// without trace (gap audit, 15 Oct 2026).
//
// And other insurance the office adds under the three (0078; mockup approved
// by Adam, 16 Oct 2026): one row each in insurance_policies, read by the same
// rules, with the same history.
//
// WHO: the licensee, which includes the agent on their own plan
// (access.actsAsLicensee). The Insurance register is theirs alone (0058), and
// so are the files in the office's _insurance folder.

export type ActionState = { error: string | null };

/** What an upload did, in words the card can show as they are. */
export type InsuranceUploadResult = {
  error: string | null;
  outcome?: "saved" | "saved_with_gaps" | "could_not_read" | "not_a_certificate" | "wrong_cover";
  message?: string;
};

type Columns = {
  insurer: string;
  policyNumber: string;
  expiry: string;
  path: string;
  fileName: string;
  read: string;
};

const COLUMNS: Record<InsurancePolicyType, Columns> = {
  pi: { insurer: "pi_insurer", policyNumber: "pi_policy_number", expiry: "pi_expiry", path: "pi_document_path", fileName: "pi_document_file_name", read: "pi_read" },
  cyber: { insurer: "cyber_insurer", policyNumber: "cyber_policy_number", expiry: "cyber_expiry", path: "cyber_document_path", fileName: "cyber_document_file_name", read: "cyber_read" },
  icare: { insurer: "icare_insurer", policyNumber: "icare_policy_number", expiry: "icare_expiry", path: "icare_document_path", fileName: "icare_document_file_name", read: "icare_read" },
};

const NOT_YOURS = "Only the licensee in charge can update the agency's insurance details.";

function isPolicy(value: unknown): value is InsurancePolicyType {
  return value === "pi" || value === "cyber" || value === "icare";
}

type Supabase = Awaited<ReturnType<typeof requireAuthContext>>["supabase"];

/** The policy as it stands on the office row. */
function current(agency: Agency, policy: InsurancePolicyType) {
  const a = agency as unknown as Record<string, unknown>;
  const c = COLUMNS[policy];
  const text = (k: string) => (typeof a[k] === "string" && (a[k] as string).length > 0 ? (a[k] as string) : null);
  return {
    values: { insurer: text(c.insurer), policyNumber: text(c.policyNumber), expiry: text(c.expiry) } as InsuranceValues,
    path: text(c.path),
    fileName: text(c.fileName),
    read: parseInsuranceRead(a[c.read]),
  };
}

function row(policy: InsurancePolicyType, values: Partial<InsuranceValues>, extra: Record<string, unknown>) {
  const c = COLUMNS[policy];
  const out: Record<string, unknown> = { ...extra };
  if ("insurer" in values) out[c.insurer] = values.insurer;
  if ("policyNumber" in values) out[c.policyNumber] = values.policyNumber;
  if ("expiry" in values) out[c.expiry] = values.expiry;
  return out;
}

async function loadAgency(supabase: Supabase, agencyId: string): Promise<Agency | null> {
  const { data } = await supabase.from("agencies").select("*").eq("id", agencyId).maybeSingle();
  return (data as Agency | null) ?? null;
}

/** Removes a refused upload, and says whether it went. Checked, not assumed. */
async function discardUpload(supabase: Supabase, path: string): Promise<boolean> {
  const { data: removed, error } = await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
  const deleted = !error && (removed?.length ?? 0) > 0;
  // The folder only, never the file name.
  if (!deleted) console.error("refused insurance upload not deleted:", path.split("/").slice(0, 3).join("/"), error?.message);
  return deleted;
}

/**
 * Adam's message when the stored file is empty (19 Oct 2026), else null. The
 * empty upload is removed like any refused one; nothing is saved.
 */
async function refuseEmpty(supabase: Supabase, path: string): Promise<string | null> {
  const empty = await storedFileProblem(supabase, path);
  if (empty) await discardUpload(supabase, path);
  return empty;
}

type CertificateRead =
  | { kind: "could_not_read"; message: string; state: InsuranceReadState }
  | { kind: "refused"; result: InsuranceUploadResult }
  | { kind: "save"; decision: Extract<InsuranceReadDecision, { kind: "save" }> };

/**
 * Reads an uploaded certificate and decides what it means for this policy.
 * Shared by the three fixed policies and the added ones, so they follow the
 * same rules. A refused upload (not a certificate, or the wrong cover) is
 * removed here; nothing else is written.
 */
async function readCertificate(
  supabase: Supabase,
  policy: AnyPolicy,
  path: string,
  fileName: string,
  by: string,
  now: Date,
): Promise<CertificateRead> {
  const at = now.toISOString();
  const { error: readError, raw } = await extractInsuranceCertificate(path, fileName);
  if (readError) return { kind: "could_not_read", message: readError, state: couldNotReadState(by, at, fileName) };

  const decision = decideInsuranceRead({ read: sanitiseInsuranceRead(raw), policy, by, at, fileName, today: now });
  if (decision.kind === "not_a_certificate") {
    const kept = !(await discardUpload(supabase, path));
    return { kind: "refused", result: { error: null, outcome: "not_a_certificate", message: notACertificateMessage(kept) } };
  }
  if (decision.kind === "wrong_cover") {
    const kept = !(await discardUpload(supabase, path));
    return {
      kind: "refused",
      result: { error: null, outcome: "wrong_cover", message: wrongCoverMessage(policy, decision.coverOnDocument, kept) },
    };
  }
  return { kind: "save", decision };
}

/**
 * A certificate just uploaded to the office's folder for this policy: read it
 * and save what it says. A wrong document saves nothing and is removed; one
 * that can't be read stays attached and every detail is asked for.
 */
export async function attachInsuranceCertificate(
  policy: InsurancePolicyType,
  path: string,
  fileName: string,
): Promise<InsuranceUploadResult> {
  if (!isPolicy(policy)) return { error: "Unknown policy." };
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };
  // Only a file in this policy's own folder (the database refuses anything
  // else too, 0076), so this can never be pointed at another document.
  if (!isInFolder(path, insuranceFolder(profile.agency_id, policy))) {
    return { error: "That upload isn't in this policy's folder. Try again." };
  }
  const empty = await refuseEmpty(supabase, path);
  if (empty) return { error: empty };
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };

  const before = current(agency, policy);
  const now = new Date();
  const name = fileName.trim() || "certificate";
  const c = COLUMNS[policy];

  const read = await readCertificate(supabase, policy, path, name, profile.id, now);

  if (read.kind === "could_not_read") {
    // Kept on the policy, and everything asked for: last year's details are
    // not this certificate's. The history keeps them.
    const { error } = await supabase
      .from("agencies")
      .update(row(policy, { insurer: null, policyNumber: null, expiry: null }, { [c.path]: path, [c.fileName]: name, [c.read]: read.state }))
      .eq("id", agency.id);
    if (error) return { error: "Couldn't save the certificate. Try again." };
    revalidatePath("/dashboard/registers");
    return { error: null, outcome: "could_not_read", message: read.message };
  }
  if (read.kind === "refused") return read.result;
  const { decision } = read;

  const { error } = await supabase
    .from("agencies")
    .update(row(policy, decision.values, { [c.path]: path, [c.fileName]: name, [c.read]: decision.state }))
    .eq("id", agency.id);
  if (error) return { error: "Couldn't save what was read. Try again." };

  revalidatePath("/dashboard/registers");
  return {
    error: null,
    outcome: decision.state.missing.length === 0 ? "saved" : "saved_with_gaps",
    message: savedMessage({
      state: decision.state,
      expired: decision.expired,
      beforeExpiry: before.values.expiry,
      afterExpiry: decision.values.expiry,
      replacedCertificate: Boolean(before.path) && before.path !== path,
      formatDate: formatAuDate,
    }),
  };
}

/** The details a form sent. A field it didn't send is absent, not blank. */
function sentValues(formData: FormData): Partial<InsuranceValues> {
  const sent: Partial<InsuranceValues> = {};
  for (const field of INSURANCE_FIELDS) {
    if (!formData.has(field)) continue;
    const v = formData.get(field);
    const s = typeof v === "string" ? v.trim() : "";
    sent[field] = s.length > 0 ? s : null;
  }
  return sent;
}

/**
 * Details typed by hand: Edit (all three), or answering what the read
 * couldn't give (only those). A field the form didn't send is left alone, so
 * answering "what's the expiry date?" can never blank the insurer.
 */
export async function saveInsuranceDetails(
  policy: InsurancePolicyType,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!isPolicy(policy)) return { error: "Unknown policy." };
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };

  const sent = sentValues(formData);
  if (sent.expiry && !validIsoDate(sent.expiry)) return { error: "Enter the expiry date as a date." };
  if (Object.keys(sent).length === 0) return { error: null };

  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };
  const before = current(agency, policy);
  const after: InsuranceValues = { ...before.values, ...sent };
  if (INSURANCE_FIELDS.every((f: InsuranceField) => before.values[f] === after[f])) return { error: null };

  const state: InsuranceReadState = recordTypedInsurance(before.read, before.values, after, profile.id, new Date().toISOString());
  const { error } = await supabase
    .from("agencies")
    .update(row(policy, sent, { [COLUMNS[policy].read]: state }))
    .eq("id", profile.agency_id);
  if (error) return { error: "Couldn't save the insurance details. Try again." };

  revalidatePath("/dashboard/registers");
  return { error: null };
}

/**
 * Takes the certificate off the policy. The details stay, and so does the
 * file: the history names it, so it is still there to show.
 */
export async function removeInsuranceCertificate(policy: InsurancePolicyType): Promise<ActionState> {
  if (!isPolicy(policy)) return { error: "Unknown policy." };
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };
  const before = current(agency, policy);
  if (!before.path) return { error: null };

  const c = COLUMNS[policy];
  const { error } = await supabase
    .from("agencies")
    .update({ [c.path]: null, [c.fileName]: null, [c.read]: removedCertificateState(before.read) })
    .eq("id", agency.id);
  if (error) return { error: "Couldn't take the certificate off. Try again." };

  revalidatePath("/dashboard/registers");
  return { error: null };
}

// ── Other insurance (0078) ──────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Management liability", tidied; null when there is nothing or too much. */
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > 0 && s.length <= OTHER_INSURANCE_NAME_MAX ? s : null;
}

/** An added policy still on the register, in the caller's own office. */
async function loadOtherPolicy(supabase: Supabase, agencyId: string, policyId: string): Promise<InsurancePolicy | null> {
  if (!UUID.test(policyId)) return null;
  const { data } = await supabase
    .from("insurance_policies")
    .select("*")
    .eq("id", policyId)
    .eq("agency_id", agencyId)
    .is("removed_at", null)
    .maybeSingle();
  return (data as InsurancePolicy | null) ?? null;
}

function otherValues(p: InsurancePolicy): InsuranceValues {
  return { insurer: p.insurer || null, policyNumber: p.policy_number || null, expiry: p.expiry || null };
}

function otherRow(values: Partial<InsuranceValues>, extra: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...extra };
  if ("insurer" in values) out.insurer = values.insurer;
  if ("policyNumber" in values) out.policy_number = values.policyNumber;
  if ("expiry" in values) out.expiry = values.expiry;
  return out;
}

/**
 * "+ Add other insurance": the type, its name for "Other", and the
 * certificate, already uploaded to the new policy's own folder. Read like the
 * three; the policy is created only if the certificate is one. Not a
 * certificate, or a different cover: nothing is added and the file is
 * removed. One that can't be read: added, with every detail asked for.
 */
export async function addOtherInsurance(input: {
  policyId: string;
  kind: OtherInsuranceKind;
  name: string | null;
  path: string;
  fileName: string;
}): Promise<InsuranceUploadResult> {
  const { policyId, kind, path } = input;
  if (!isOtherInsuranceKind(kind)) return { error: "Choose the type of insurance." };
  if (typeof policyId !== "string" || !UUID.test(policyId)) return { error: "Something went wrong. Try again." };
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };
  // Only a file in this new policy's own folder (the database refuses
  // anything else too, 0078).
  if (typeof path !== "string" || !isInFolder(path, otherInsuranceFolder(profile.agency_id, policyId))) {
    return { error: "That upload isn't in this policy's folder. Try again." };
  }
  const empty = await refuseEmpty(supabase, path);
  if (empty) return { error: empty };
  const name = kind === "other" ? cleanName(input.name) : null;
  if (kind === "other" && !name) {
    await discardUpload(supabase, path);
    return { error: `Name the insurance (up to ${OTHER_INSURANCE_NAME_MAX} characters).` };
  }

  const now = new Date();
  const fileName = (typeof input.fileName === "string" && input.fileName.trim()) || "certificate";
  const title = otherInsuranceTitle(kind, name);
  const read = await readCertificate(supabase, kind, path, fileName, profile.id, now);
  if (read.kind === "refused") return read.result;

  const base = {
    id: policyId,
    agency_id: profile.agency_id,
    kind,
    name,
    document_path: path,
    document_file_name: fileName,
  };
  const state = read.kind === "save" ? read.decision.state : read.state;
  const values: InsuranceValues = read.kind === "save" ? read.decision.values : { insurer: null, policyNumber: null, expiry: null };
  const { error } = await supabase.from("insurance_policies").insert(otherRow(values, { ...base, read: state }));
  if (error) {
    // Nothing was added, so the file belongs to nothing.
    await discardUpload(supabase, path);
    console.error("other insurance not added:", error.message);
    return { error: "Couldn't add the policy. Try again." };
  }

  revalidatePath("/dashboard/registers");
  const outcome =
    read.kind === "could_not_read" ? "could_not_read" : state.missing.length === 0 ? "saved" : "saved_with_gaps";
  return {
    error: null,
    outcome,
    message: addedMessage({ title, state, expired: read.kind === "save" && read.decision.expired }),
  };
}

/**
 * A renewed certificate for an added policy, already uploaded to its folder.
 * The same as for the three: the expiry moves on, and the database keeps the
 * previous certificate in the history.
 */
export async function attachOtherInsuranceCertificate(
  policyId: string,
  path: string,
  fileName: string,
): Promise<InsuranceUploadResult> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };
  const policy = await loadOtherPolicy(supabase, profile.agency_id, policyId);
  if (!policy) return { error: "Couldn't find that policy. It may have been removed." };
  if (!isInFolder(path, otherInsuranceFolder(profile.agency_id, policy.id))) {
    return { error: "That upload isn't in this policy's folder. Try again." };
  }
  const empty = await refuseEmpty(supabase, path);
  if (empty) return { error: empty };

  const before = otherValues(policy);
  const now = new Date();
  const name = fileName.trim() || "certificate";
  const read = await readCertificate(supabase, policy.kind, path, name, profile.id, now);

  if (read.kind === "could_not_read") {
    const { error } = await supabase
      .from("insurance_policies")
      .update(otherRow({ insurer: null, policyNumber: null, expiry: null }, { document_path: path, document_file_name: name, read: read.state }))
      .eq("id", policy.id);
    if (error) return { error: "Couldn't save the certificate. Try again." };
    revalidatePath("/dashboard/registers");
    return { error: null, outcome: "could_not_read", message: read.message };
  }
  if (read.kind === "refused") return read.result;
  const { decision } = read;

  const { error } = await supabase
    .from("insurance_policies")
    .update(otherRow(decision.values, { document_path: path, document_file_name: name, read: decision.state }))
    .eq("id", policy.id);
  if (error) return { error: "Couldn't save what was read. Try again." };

  revalidatePath("/dashboard/registers");
  return {
    error: null,
    outcome: decision.state.missing.length === 0 ? "saved" : "saved_with_gaps",
    message: savedMessage({
      state: decision.state,
      expired: decision.expired,
      beforeExpiry: before.expiry,
      afterExpiry: decision.values.expiry,
      replacedCertificate: Boolean(policy.document_path) && policy.document_path !== path,
      formatDate: formatAuDate,
    }),
  };
}

/**
 * Edit on an added policy, or answering what the read couldn't give. As for
 * the three, a field the form didn't send is left alone. A policy the office
 * named can be renamed here too.
 */
export async function saveOtherInsuranceDetails(
  policyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };

  const sent = sentValues(formData);
  if (sent.expiry && !validIsoDate(sent.expiry)) return { error: "Enter the expiry date as a date." };

  const policy = await loadOtherPolicy(supabase, profile.agency_id, policyId);
  if (!policy) return { error: "Couldn't find that policy. It may have been removed." };

  const extra: Record<string, unknown> = {};
  if (policy.kind === "other" && formData.has("name")) {
    const name = cleanName(formData.get("name"));
    if (!name) return { error: `Name the insurance (up to ${OTHER_INSURANCE_NAME_MAX} characters).` };
    if (name !== policy.name) extra.name = name;
  }

  const before = otherValues(policy);
  const after: InsuranceValues = { ...before, ...sent };
  const detailsChanged = INSURANCE_FIELDS.some((f: InsuranceField) => before[f] !== after[f]);
  if (!detailsChanged && Object.keys(extra).length === 0) return { error: null };
  if (detailsChanged) {
    extra.read = recordTypedInsurance(parseInsuranceRead(policy.read), before, after, profile.id, new Date().toISOString());
  }

  const { error } = await supabase
    .from("insurance_policies")
    .update(otherRow(detailsChanged ? sent : {}, extra))
    .eq("id", policy.id);
  if (error) return { error: "Couldn't save the insurance details. Try again." };

  revalidatePath("/dashboard/registers");
  return { error: null };
}

/**
 * Takes an added policy off the register. Nothing is deleted: the policy, its
 * certificates and its history stay in the office's records, and the
 * database stamps who removed it and when (0078).
 */
export async function removeOtherInsurance(policyId: string): Promise<ActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.actsAsLicensee) return { error: NOT_YOURS };
  const policy = await loadOtherPolicy(supabase, profile.agency_id, policyId);
  if (!policy) return { error: null };

  const { error } = await supabase
    .from("insurance_policies")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", policy.id);
  if (error) return { error: "Couldn't remove the policy. Try again." };

  revalidatePath("/dashboard/registers");
  return { error: null };
}
