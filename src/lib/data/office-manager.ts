import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import type { Access } from "@/lib/access";
import { isAccountHolder } from "@/lib/subscription-end/access";
import {
  officeManagerCard,
  type OfficeManagerCard,
  type OfficeManagerRecord,
  type OfficeManagerRequest,
} from "@/lib/office-manager/card";

// Reads for the office manager role (0093). Every read is the signed-in
// person's own, through the database rules: a link token is never selected
// here (and can't be: 0093 grants no one signed in the column).
//
// Before 0093 is run the tables don't exist, and every read here comes back
// empty: no card, no record.

const RECORD_COLUMNS = "approved_at, approved_by_name, approved_via, withdrawn_at, withdrawn_via";

/** The Home card for the signed-in person, or null. */
export async function officeManagerCardFor(
  supabase: SupabaseClient,
  profile: Profile,
  access: Access,
): Promise<OfficeManagerCard | null> {
  if (access.isAgentPlan || access.actsAsLicensee) return null;
  const [{ data: agency }, licenseeLogin, holder, { data: records, error: recordsError }, { data: requests }] =
    await Promise.all([
      supabase.from("agencies").select("licensee_name, licensee_email").eq("id", profile.agency_id).maybeSingle(),
      supabase.rpc("office_has_active_licensee"),
      isAccountHolder(supabase),
      supabase
        .from("office_managers")
        .select(RECORD_COLUMNS)
        .eq("profile_id", profile.id)
        .order("approved_at", { ascending: false })
        .limit(5),
      supabase
        .from("office_manager_requests")
        .select("id, sent_to, email_sent_at, email_attempts, expires_at")
        .eq("profile_id", profile.id)
        .is("approved_at", null)
        .is("cancelled_at", null)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
  if (recordsError) return null;
  const a = agency as { licensee_name: string | null; licensee_email: string | null } | null;
  return officeManagerCard({
    isAgentPlan: access.isAgentPlan,
    isLicensee: access.actsAsLicensee,
    isAccountHolder: holder,
    officeHasLicenseeLogin: licenseeLogin.error ? true : licenseeLogin.data === true,
    licenseeName: a?.licensee_name ?? null,
    licenseeEmail: a?.licensee_email ?? null,
    records: (records ?? []) as OfficeManagerRecord[],
    openRequest: ((requests ?? []) as OfficeManagerRequest[])[0] ?? null,
    now: new Date(),
  });
}

export type OfficeManagerEntry = OfficeManagerRecord & {
  id: string;
  approved_by: string | null;
  profile_id: string;
  wording: string;
  withdrawn_by_name: string | null;
  person_name: string;
};

/** Every office manager approval in the office, newest first, with the person's name. */
export async function officeManagersOf(supabase: SupabaseClient, agencyId: string): Promise<OfficeManagerEntry[]> {
  const { data, error } = await supabase
    .from("office_managers")
    .select(`id, profile_id, approved_by, wording, withdrawn_by_name, ${RECORD_COLUMNS}`)
    .eq("agency_id", agencyId)
    .order("approved_at", { ascending: false });
  if (error || !data) return [];
  const rows = data as Omit<OfficeManagerEntry, "person_name">[];
  const ids = [...new Set(rows.map((r) => r.profile_id))];
  const { data: people } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const nameOf = new Map(
    ((people ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [
      p.id,
      p.full_name?.trim() || p.email,
    ]),
  );
  // A person the viewer can't read (an agent viewing Team never does) still
  // has a line: their name comes from the wording.
  return rows.map((r) => ({
    ...r,
    person_name: nameOf.get(r.profile_id) ?? r.wording.replace(/^I authorise (.+?) to manage .*$/, "$1"),
  }));
}
