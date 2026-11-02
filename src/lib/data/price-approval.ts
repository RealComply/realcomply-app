import type { SupabaseClient } from "@supabase/supabase-js";
import { priceApproval, type PriceApproval } from "@/lib/rules/price-statement";

/**
 * What the file says about the price statement card (b4), with the name of
 * whoever ticked it (2 Nov 2026: an agent ticks b4 now, and the record reads
 * "Ticked by [name], [date]"). A licensee's approval from before then reads
 * as it always did. For the summary page and the compliance record, which
 * don't otherwise load the office's people.
 */
export async function priceApprovalFor(
  supabase: SupabaseClient,
  row: { status?: string | null; data?: unknown; completed_by?: string | null } | null | undefined,
): Promise<PriceApproval | null> {
  const tickedBy = (row?.data as { tickedBy?: unknown } | null | undefined)?.tickedBy;
  if (row?.status !== "done" || typeof tickedBy !== "string") return priceApproval(row);
  const { data } = await supabase.from("profiles").select("id, full_name").eq("id", tickedBy).maybeSingle();
  const person = data as { id: string; full_name: string | null } | null;
  return priceApproval(row, person ? new Map([[person.id, { full_name: person.full_name }]]) : undefined);
}
