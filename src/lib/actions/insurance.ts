"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { extractInsuranceCertificate } from "@/lib/actions/extraction";
import { EVIDENCE_BUCKET, insuranceFolder, isInFolder } from "@/lib/storage/evidence";
import { formatAuDate } from "@/lib/format-date";
import {
  INSURANCE_FIELDS,
  couldNotReadState,
  decideInsuranceRead,
  notACertificateMessage,
  parseInsuranceRead,
  recordTypedInsurance,
  removedCertificateState,
  sanitiseInsuranceRead,
  savedMessage,
  validIsoDate,
  wrongCoverMessage,
  type InsuranceField,
  type InsuranceReadState,
  type InsuranceValues,
} from "@/lib/insurance-read";
import type { Agency, InsurancePolicyType } from "@/lib/types";

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
  const agency = await loadAgency(supabase, profile.agency_id);
  if (!agency) return { error: "Couldn't find the agency." };

  const before = current(agency, policy);
  const now = new Date();
  const at = now.toISOString();
  const name = fileName.trim() || "certificate";
  const c = COLUMNS[policy];

  const { error: readError, raw } = await extractInsuranceCertificate(path, name);

  if (readError) {
    // Kept on the policy, and everything asked for: last year's details are
    // not this certificate's. The history keeps them.
    const state = couldNotReadState(profile.id, at, name);
    const { error } = await supabase
      .from("agencies")
      .update(row(policy, { insurer: null, policyNumber: null, expiry: null }, { [c.path]: path, [c.fileName]: name, [c.read]: state }))
      .eq("id", agency.id);
    if (error) return { error: "Couldn't save the certificate. Try again." };
    revalidatePath("/dashboard/registers");
    return { error: null, outcome: "could_not_read", message: readError };
  }

  const decision = decideInsuranceRead({
    read: sanitiseInsuranceRead(raw),
    policy,
    by: profile.id,
    at,
    fileName: name,
    today: now,
  });

  if (decision.kind === "not_a_certificate") {
    const kept = !(await discardUpload(supabase, path));
    return { error: null, outcome: "not_a_certificate", message: notACertificateMessage(kept) };
  }
  if (decision.kind === "wrong_cover") {
    const kept = !(await discardUpload(supabase, path));
    return { error: null, outcome: "wrong_cover", message: wrongCoverMessage(policy, decision.coverOnDocument, kept) };
  }

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

  const sent: Partial<InsuranceValues> = {};
  for (const field of INSURANCE_FIELDS) {
    if (!formData.has(field)) continue;
    const v = formData.get(field);
    const s = typeof v === "string" ? v.trim() : "";
    sent[field] = s.length > 0 ? s : null;
  }
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
