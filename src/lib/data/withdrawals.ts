import type { SupabaseClient } from "@supabase/supabase-js";

// Listings withdrawn from sale (0114, listing_withdrawals). A row with no
// put_back_at is a listing withdrawn now. Read with the caller's own client,
// so it returns only what they may see; with the service client (the daily
// and weekly jobs) it returns every office's.
//
// Before 0114 is run the table doesn't exist: the read errors, and nothing
// counts as withdrawn, so every page and job works exactly as before.

export type Withdrawal = {
  id: string;
  agency_id: string;
  property_id: string;
  withdrawn_on: string;
  reason: string;
  reason_other: string | null;
  evidence_path: string | null;
  evidence_file_name: string | null;
  withdrawn_by: string | null;
  withdrawn_at: string;
  put_back_by: string | null;
  put_back_at: string | null;
};

const COLUMNS =
  "id, agency_id, property_id, withdrawn_on, reason, reason_other, evidence_path, evidence_file_name, withdrawn_by, withdrawn_at, put_back_by, put_back_at";

/** Listings withdrawn now, by listing. */
export async function openWithdrawals(supabase: SupabaseClient): Promise<Map<string, Withdrawal>> {
  const { data, error } = await supabase.from("listing_withdrawals").select(COLUMNS).is("put_back_at", null);
  if (error) return new Map();
  return new Map(((data ?? []) as Withdrawal[]).map((w) => [w.property_id, w]));
}

/** The ids of listings withdrawn now. */
export async function withdrawnPropertyIds(supabase: SupabaseClient): Promise<Set<string>> {
  return new Set((await openWithdrawals(supabase)).keys());
}

/** Every withdrawal and put-back on one listing, oldest first. */
export async function withdrawalHistory(supabase: SupabaseClient, propertyId: string): Promise<Withdrawal[]> {
  const { data, error } = await supabase
    .from("listing_withdrawals")
    .select(COLUMNS)
    .eq("property_id", propertyId)
    .order("withdrawn_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as Withdrawal[];
}
