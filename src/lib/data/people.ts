import type { createClient } from "@/lib/supabase/server";

// Everyone in the office, names and roles only (agency_people() in 0058).
//
// Since 0058 an agent can read only their own profile (and their
// assistant's): emails, licences and CPD stay with the person and the
// licensee (Adam, 7 Oct 2026: "names only, not emails, licences or CPD").
// Anything that just needs to show who someone is, or to know who the
// licensee is, reads this instead.
export type Person = {
  id: string;
  full_name: string | null;
  is_licensee_in_charge: boolean;
  is_assistant: boolean;
  is_agent: boolean;
  archived_at: string | null;
};

export async function agencyPeople(supabase: Awaited<ReturnType<typeof createClient>>): Promise<Person[]> {
  const { data } = await supabase.rpc("agency_people");
  return (data ?? []) as Person[];
}
