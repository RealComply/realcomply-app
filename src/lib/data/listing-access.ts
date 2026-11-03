import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";

// What an office manager does with other agents' work (Adam, 3 Nov 2026;
// 0108): "the office manager sees everything", to read only ("see them").
// The database lets them read every listing and property under management in
// the office (can_read_property) but change only their own (can_see_property,
// unchanged). The app follows the same line: another agent's listing opens as
// its read-only record, another manager's property as its history, and their
// own to-dos and counts stay their own work.
//
// Everyone else is unchanged: the database already shows an agent or an
// assistant only the work they do, and the licensee everything.

/** True when the viewer reads more than they work on: an office manager who isn't the licensee. */
export function readsBeyondOwnWork(access: Pick<Access, "actsAsLicensee" | "isOfficeManager">): boolean {
  return access.isOfficeManager && !access.actsAsLicensee;
}

/** Whether the viewer can work on (change) this listing, as the database decides. */
export async function worksOnListing(
  supabase: SupabaseClient,
  access: Pick<Access, "actsAsLicensee" | "isOfficeManager">,
  viewerId: string,
  listing: { id: string; created_by: string },
): Promise<boolean> {
  if (!readsBeyondOwnWork(access) || listing.created_by === viewerId) return true;
  const { data, error } = await supabase.rpc("can_see_property", { p_property: listing.id });
  return !error && data === true;
}

/** Whether the viewer can work on this property under management, as the database decides. */
export async function worksOnPmProperty(
  supabase: SupabaseClient,
  access: Pick<Access, "actsAsLicensee" | "isOfficeManager">,
  viewerId: string,
  property: { id: string; manager_id: string | null },
): Promise<boolean> {
  if (!readsBeyondOwnWork(access) || property.manager_id === viewerId) return true;
  const { data, error } = await supabase.rpc("can_see_pm_property", { p_property: property.id });
  return !error && data === true;
}

/**
 * The listings that are the viewer's own work, from those they can read: for
 * an office manager, theirs (and, if they assist agents, those agents'); for
 * everyone else, everything they can read already is.
 */
export function ownWork<T extends { created_by: string }>(
  listings: T[],
  access: Pick<Access, "actsAsLicensee" | "isOfficeManager">,
  viewerId: string,
  assistedAgentIds: ReadonlySet<string> = new Set(),
): T[] {
  if (!readsBeyondOwnWork(access)) return listings;
  return listings.filter((l) => l.created_by === viewerId || assistedAgentIds.has(l.created_by));
}
