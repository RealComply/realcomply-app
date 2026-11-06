import type { createClient } from "@/lib/supabase/server";
import { agencyPeople } from "@/lib/data/people";
import { openWithdrawals, type Withdrawal } from "@/lib/data/withdrawals";
import { fileProgress, tabFor, type ListingTab } from "@/lib/rules/listing-tabs";
import type { Property, PropertyItem } from "@/lib/types";

// Every listing the viewer can see, with its tab and what its row says
// (Job B, 6 Nov 2026). Who sees which listings is the database's rule
// (properties RLS): an agent their own, the licensee the office's.

export type ListingTabRow = {
  property: Property;
  tab: ListingTab;
  agentName: string | null;
  /** Required cards not done, across all six stages (not the licensee's signature). */
  cardsLeft: number;
  signedOff: boolean;
  /** From the Order on the agent card (YYYY-MM-DD), if recorded. */
  settlementDate: string | null;
  /** When the licensee signed the file off (ISO), if they have. */
  signedOffAt: string | null;
  withdrawal: Withdrawal | null;
};

/** The settlement date on the Order on the agent card, if recorded. */
function settlementDateFrom(row: PropertyItem | undefined): string | null {
  const v = (row?.data as { settlementDate?: unknown } | null | undefined)?.settlementDate;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** When the licensee signed off, as the sign card records it. */
function signedOffAtFrom(row: PropertyItem | undefined): string | null {
  if (row?.status !== "done") return null;
  const at = (row.data as { signedAt?: unknown } | null)?.signedAt;
  return typeof at === "string" ? at : (row.recorded_at ?? row.created_at ?? null);
}

export async function listingTabRowsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ListingTabRow[]> {
  const { data: propertyRows } = await supabase.from("properties").select("*").order("created_at", { ascending: false });
  const properties = (propertyRows ?? []) as Property[];
  if (properties.length === 0) return [];

  const ids = properties.map((p) => p.id);
  const [{ data: itemRows }, people, withdrawn] = await Promise.all([
    supabase.from("property_items").select("*").in("property_id", ids),
    agencyPeople(supabase),
    openWithdrawals(supabase),
  ]);

  const itemsByProperty = new Map<string, Record<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    const map = itemsByProperty.get(row.property_id) ?? {};
    map[row.item_key] = row;
    itemsByProperty.set(row.property_id, map);
  }
  const licenseeIds = new Set(people.filter((x) => x.is_licensee_in_charge).map((x) => x.id));
  const names = new Map(people.map((x) => [x.id, x.full_name ?? null]));

  return properties.map((property) => {
    const allItems = itemsByProperty.get(property.id) ?? {};
    const progress = fileProgress(property, allItems, { agentIsLicensee: licenseeIds.has(property.created_by) });
    const withdrawal = withdrawn.get(property.id) ?? null;
    return {
      property,
      tab: tabFor({
        storedStage: property.stage,
        withdrawn: withdrawal !== null,
        allStagesComplete: progress.allStagesComplete,
        signedOff: progress.signedOff,
      }),
      agentName: names.get(property.created_by) ?? null,
      cardsLeft: progress.cardsLeft,
      signedOff: progress.signedOff,
      settlementDate: settlementDateFrom(allItems.f5),
      signedOffAt: signedOffAtFrom(allItems.sign_licensee),
      withdrawal,
    };
  });
}
