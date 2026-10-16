import type { SupabaseClient } from "@supabase/supabase-js";
import type { LicenseeChangeStatus } from "@/lib/licensee-history";

// Whether the signed-in person's office is waiting on a new licensee in charge
// to adopt the annexure (0080, my_licensee_change_status). The database is the
// rule on every new listing; this is what the pages, Home and createProperty
// ask so they can say why. A failed read (before 0080 has run) reads as no
// change: no lock shown, and the database still decides.
export async function licenseeChangeStatus(supabase: SupabaseClient): Promise<LicenseeChangeStatus | null> {
  const { data, error } = await supabase.rpc("my_licensee_change_status");
  if (error) return null;
  const row = ((data ?? []) as Array<{
    annexure_pending: boolean | null;
    licensee_name: string | null;
    previous_adopter: string | null;
  }>)[0];
  if (!row) return null;
  return {
    annexurePending: row.annexure_pending === true,
    licenseeName: row.licensee_name?.trim() || null,
    previousAdopter: row.previous_adopter?.trim() || null,
  };
}
