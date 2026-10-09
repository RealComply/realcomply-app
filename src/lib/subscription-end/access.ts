import type { SupabaseClient } from "@supabase/supabase-js";
import { accessFrom } from "@/lib/access";
import type { Profile } from "@/lib/types";

// Whether the signed-in person's agency has ended, and what they may do about
// it.
//
// From the end date, every signed-in route for that agency shows one page:
// the records page. Only two people can use it (brief, item 2): the licensee
// in charge and the account holder. Everyone else in the agency sees a short
// page telling them to contact their licensee.
//
// THE ACCOUNT HOLDER is the person who created the agency (Adam, 8 Oct 2026).
// The agency row does not record a creator, but the creator's profile is made
// in the same transaction as the agency, so the earliest profile in the
// agency is theirs. On an individual agent plan that is the agent.

export type EndedState = {
  agencyId: string;
  agencyName: string;
  endedAt: Date;
  /** Licensee in charge or account holder. */
  mayUseRecords: boolean;
  isAccountHolder: boolean;
};

/**
 * For the cron jobs only, with the service client. Through a signed-in
 * person's own connection this is wrong since 0058: an agent sees only
 * themself and their assistants, so the earliest profile they can see is
 * their own. Use isAccountHolder() for the signed-in person.
 */
export async function accountHolderId(supabase: SupabaseClient, agencyId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/**
 * Whether the signed-in person is their agency's account holder, asked of the
 * database (0059), which can see the whole agency (preview check, 9 Oct 2026:
 * every agent counted as the account holder and Billing opened for them). An
 * error, including 0059 not having run yet, reads as no.
 */
export async function isAccountHolder(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_account_holder");
  return !error && data === true;
}

/** Null when the agency is current, which is every agency almost always. */
export async function endedStateFor(supabase: SupabaseClient, profile: Profile): Promise<EndedState | null> {
  const { data } = await supabase
    .from("agencies")
    .select("id, name, ended_at, plan")
    .eq("id", profile.agency_id)
    .maybeSingle();

  const agency = data as { id: string; name: string; ended_at: string | null; plan: string | null } | null;
  if (!agency?.ended_at) return null;

  // The agent on their own plan is the account holder (lib/access.ts).
  const access = accessFrom(profile, agency.plan);
  const holder = (await isAccountHolder(supabase)) || (access.isAgentPlan && access.actsAsLicensee);

  return {
    agencyId: agency.id,
    agencyName: agency.name,
    endedAt: new Date(agency.ended_at),
    mayUseRecords: holder || profile.is_licensee_in_charge === true,
    isAccountHolder: holder,
  };
}
