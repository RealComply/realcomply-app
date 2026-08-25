"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";

export type ActionState = { error: string | null; saved?: boolean };

// ── The accounts themselves ───────────────────────────────────────────────
//
// Licensee-only, all three. An assistant can upload a reconciliation into an
// account but cannot decide what accounts the agency operates — that is a
// statement about the business, not clerical work.

export async function createTrustAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can add a trust account." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the account a name — whatever you call it in the office." };
  if (name.length > 80) return { error: "That name is too long. Eighty characters is the limit." };

  const { error } = await supabase
    .from("trust_accounts")
    .insert({ agency_id: profile.agency_id, name });

  if (error) return { error: "Couldn't add that account — try again." };
  revalidatePath("/dashboard/trust");
  return { error: null, saved: true };
}

export async function renameTrustAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can rename a trust account." };
  }

  const id = String(formData.get("accountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return { error: "Give the account a name." };

  const { error } = await supabase.from("trust_accounts").update({ name }).eq("id", id);
  if (error) return { error: "Couldn't rename that account — try again." };
  revalidatePath("/dashboard/trust");
  return { error: null, saved: true };
}

// Archive, never delete. The reconciliations filed against a closed account are
// still records the agency has to keep, and a register that can be erased is
// not evidence of anything.
export async function setTrustAccountArchived(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can close a trust account." };
  }

  const id = String(formData.get("accountId") ?? "");
  const archived = formData.get("archived") === "yes";
  if (!id) return { error: "Couldn't work out which account that was." };

  const { error } = await supabase
    .from("trust_accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);

  if (error) return { error: "Couldn't update that account — try again." };
  revalidatePath("/dashboard/trust");
  return { error: null, saved: true };
}

// The annual trust account audit — s111 and s112, Property and Stock Agents
// Act 2002 (NSW).
//
// LICENSEE ONLY, and unlike the monthly reconciliation there is no exception
// for an assistant. Uploading a reconciliation is clerical; asserting that the
// agency's trust account has been audited is the licensee's own statement, and
// s111 puts the obligation on the licensee personally.
//
// ONE ROW PER ACCOUNT PER PERIOD (Adam, 25 Aug 2026: "annual audit is 1
// per account"). Upserted rather than inserted, upserted rather than inserted, because this is a
// record that gets filled in over months — the auditor is engaged, the report
// arrives weeks later, the confirmation comes last. Three separate saves
// against the same period.
export async function saveTrustAudit(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can record the trust account audit." };
  }

  const periodEnd = String(formData.get("periodEnd") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return { error: "Couldn't work out which audit period that was — reload the page and try again." };
  }

  // One audit per account per year (Adam, 25 Aug 2026: "annual audit is 1 per
  // account"). Without this the upsert below would collide across accounts.
  const trustAccountId = String(formData.get("trustAccountId") ?? "").trim();
  if (!trustAccountId) {
    return { error: "Couldn't work out which trust account that was — reload the page and try again." };
  }

  const auditorName = String(formData.get("auditorName") ?? "").trim() || null;
  const reportReceivedOn = String(formData.get("reportReceivedOn") ?? "").trim() || null;
  const filePath = String(formData.get("filePath") ?? "").trim() || null;
  const fileName = String(formData.get("fileName") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const confirmed = formData.get("confirmed") === "yes";

  // Read first, so a save that only carries the auditor's name doesn't wipe a
  // confirmation already given, and so un-ticking is a deliberate act rather
  // than a side effect of saving some other field.
  const { data: existing } = await supabase
    .from("trust_audits")
    .select("id, confirmed_by, confirmed_at, file_path, file_name")
    .eq("agency_id", profile.agency_id)
    .eq("trust_account_id", trustAccountId)
    .eq("period_end", periodEnd)
    .maybeSingle();

  const row = {
    agency_id: profile.agency_id,
    trust_account_id: trustAccountId,
    period_end: periodEnd,
    auditor_name: auditorName,
    report_received_on: reportReceivedOn,
    // A save that carries no new file keeps the one already on record.
    file_path: filePath ?? existing?.file_path ?? null,
    file_name: fileName ?? existing?.file_name ?? null,
    notes,
    confirmed_by: confirmed ? profile.id : null,
    // Keep the original timestamp when a confirmation is merely being re-saved
    // alongside another field. The date on a confirmation is part of it.
    confirmed_at: confirmed ? existing?.confirmed_at ?? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("trust_audits")
    .upsert(row, { onConflict: "agency_id,trust_account_id,period_end" });

  if (error) {
    return { error: "Couldn't save that — try again." };
  }

  revalidatePath("/dashboard/trust");
  return { error: null, saved: true };
}
