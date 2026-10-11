"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { daysUntil, sydneyToday } from "@/lib/trust-account";

export type ActionState = { error: string | null; saved?: boolean };

// The day the account opened, if the licensee gave one (10 Oct 2026). Months
// and audit years that ended before it are not asked for — see
// monthBeforeOpening in lib/trust-account.ts. Blank means it was already open.
//
// Not more than a month ahead (10 Oct 2026). A date in the future quietly
// marks every month before it "Before it opened" and the year's audit as not
// owed, so a mistyped year (2027 for 2026) took an open account's overdue
// reconciliations and audit off the page, the badge and the reminders with
// no warning. A month still lets an account about to open be set up early.
const OPENED_ON_MAX_DAYS_AHEAD = 31;

function openedOnFrom(formData: FormData): { openedOn: string | null; error: string | null } {
  const value = String(formData.get("openedOn") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { openedOn: null, error: null };
  if (daysUntil(value, sydneyToday()) > OPENED_ON_MAX_DAYS_AHEAD) {
    return {
      openedOn: null,
      error: "The opening date is more than a month away. Check the year — months before it are not asked for.",
    };
  }
  return { openedOn: value, error: null };
}

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

  const { openedOn, error: openedOnError } = openedOnFrom(formData);
  if (openedOnError) return { error: openedOnError };
  const { error } = await supabase
    .from("trust_accounts")
    .insert({ agency_id: profile.agency_id, name, ...(openedOn ? { opened_on: openedOn } : {}) });

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

  // Written only when it changed, so a plain rename never touches it.
  const { openedOn, error: openedOnError } = openedOnFrom(formData);
  if (openedOnError) return { error: openedOnError };
  const openedOnWas = String(formData.get("openedOnWas") ?? "").trim() || null;
  const { error } = await supabase
    .from("trust_accounts")
    .update(openedOn === openedOnWas ? { name } : { name, opened_on: openedOn })
    .eq("id", id);
  if (error) return { error: "Couldn't save that account — try again." };
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
// per account"). Updated in place when it exists, because this is a
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
    // Kept with its date (10 Oct 2026). A second licensee re-saving a confirmed
    // audit to add the report date was rewriting who confirmed it while the
    // original date stayed, so the record said they confirmed it on a day they
    // did not. Who and when are one fact; they change together or not at all.
    confirmed_by: confirmed ? (existing?.confirmed_at ? existing.confirmed_by : profile.id) : null,
    // Keep the original timestamp when a confirmation is merely being re-saved
    // alongside another field. The date on a confirmation is part of it.
    confirmed_at: confirmed ? existing?.confirmed_at ?? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  // Update-or-insert by hand rather than .upsert(): the unique index is on
  // coalesce(trust_account_id, nil uuid) (migration 0032), and Postgres cannot
  // match ON CONFLICT (agency_id, trust_account_id, period_end) to an
  // expression index — every save failed with 42P10. The index still stops a
  // second row for the same account and period.
  const { error } = existing
    ? await supabase.from("trust_audits").update(row).eq("id", existing.id)
    : await supabase.from("trust_audits").insert(row);

  if (error) {
    return { error: "Couldn't save that — try again." };
  }

  revalidatePath("/dashboard/trust");
  return { error: null, saved: true };
}
