import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import type { Access } from "@/lib/access";
import { isAccountHolder } from "@/lib/subscription-end/access";
import {
  licenseeOfficeManagerHome,
  officeManagerHome,
  type OfficeManagerCard,
  type OfficeManagerLine,
  type OfficeManagerNews,
  type OfficeManagerRecord,
  type OfficeManagerRequest,
} from "@/lib/office-manager/card";

// Reads for the office manager role (0093). Every read is the signed-in
// person's own, through the database rules: a link token is never selected
// here (and can't be: 0093 grants no one signed in the column).
//
// Before 0093 is run the tables don't exist, and every read here comes back
// empty: no card, no record.

const RECORD_COLUMNS = "id, approved_at, approved_by_name, approved_via, withdrawn_at, withdrawn_via, withdrawn_by_name";

/**
 * The Home cards the signed-in person has seen (0096). Null before 0096 is
 * run, or on any error: every card then counts as unseen and shows as before.
 */
async function seenHomeNotices(supabase: SupabaseClient): Promise<Set<string> | null> {
  const { data, error } = await supabase.from("home_notices_seen").select("notice_key").like("notice_key", "om-%");
  if (error || !data) return null;
  return new Set((data as { notice_key: string }[]).map((r) => r.notice_key));
}

export type OfficeManagerHome = { card: OfficeManagerCard | null; line: OfficeManagerLine | null };

/** The Home card for the signed-in person, or once seen, the small line. */
export async function officeManagerHomeFor(
  supabase: SupabaseClient,
  profile: Profile,
  access: Access,
): Promise<OfficeManagerHome> {
  const none = { card: null, line: null };
  if (access.isAgentPlan || access.actsAsLicensee) return none;
  const [
    { data: agency },
    licenseeLogin,
    holder,
    { data: records, error: recordsError },
    { data: requests },
    seenKeys,
  ] = await Promise.all([
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
      seenHomeNotices(supabase),
    ]);
  if (recordsError) return none;
  const a = agency as { licensee_name: string | null; licensee_email: string | null } | null;
  return officeManagerHome({
    isAgentPlan: access.isAgentPlan,
    isLicensee: access.actsAsLicensee,
    isAccountHolder: holder,
    officeHasLicenseeLogin: licenseeLogin.error ? true : licenseeLogin.data === true,
    licenseeName: a?.licensee_name ?? null,
    licenseeEmail: a?.licensee_email ?? null,
    records: (records ?? []) as OfficeManagerRecord[],
    openRequest: ((requests ?? []) as OfficeManagerRequest[])[0] ?? null,
    now: new Date(),
    seenKeys,
    personName: profile.full_name?.trim() || profile.email,
  });
}

/**
 * The licensee in charge's Home (with a login): a card once per new office
 * manager, then a small line for each (0096). Empty for anyone else.
 */
export async function licenseeOfficeManagerHomeFor(
  supabase: SupabaseClient,
  profile: Profile,
  access: Access,
): Promise<{ cards: OfficeManagerNews[]; lines: OfficeManagerLine[] }> {
  if (!access.officeLicensee || !profile.agency_id) return { cards: [], lines: [] };
  const [records, seenKeys] = await Promise.all([
    officeManagersOf(supabase, profile.agency_id),
    seenHomeNotices(supabase),
  ]);
  return licenseeOfficeManagerHome({
    isOfficeLicensee: true,
    viewerId: profile.id,
    records,
    seenKeys,
    now: new Date(),
  });
}

export type OfficeManagerEntry = OfficeManagerRecord & {
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
    .select(`profile_id, approved_by, wording, ${RECORD_COLUMNS}`)
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
