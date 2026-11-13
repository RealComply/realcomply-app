import type { SupabaseClient } from "@supabase/supabase-js";
import { pageCheckFrom, type PageReads } from "@/lib/listings-pages";

// What the morning's read made of the two pages a listing is looked for on:
// the listing agent's own listings page and the office's (listings_page_checks,
// 0105). The advertised price card uses it so a page that couldn't be read is
// said to be unread, not to be missing the listing (Adam, 11 Nov 2026; see
// searchLine in lib/listings-pages.ts). Read with the caller's own client: the
// office reads its own checks.

export async function listingsPageReadsFor(
  supabase: SupabaseClient,
  agencyId: string,
  listingAgentId: string | null | undefined,
): Promise<PageReads> {
  const keys = [`office:${agencyId}`, ...(listingAgentId ? [`agent:${listingAgentId}`] : [])];
  const { data, error } = await supabase.from("listings_page_checks").select("*").in("page_key", keys);
  if (error) return {};
  const reads: PageReads = {};
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const check = pageCheckFrom(row);
    if (!check) continue;
    if (check.pageKey === `office:${agencyId}`) reads.office = check;
    else reads.agent = check;
  }
  return reads;
}
