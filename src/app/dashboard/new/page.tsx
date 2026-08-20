import { requireProfile } from "@/lib/data/current-profile";
import { createClient } from "@/lib/supabase/server";
import { NewPropertyForm } from "@/components/property/NewPropertyForm";
import type { Profile } from "@/lib/types";

// Server component so the browser has the agency_id it needs to upload
// setup documents straight to Storage (see NewPropertyForm.tsx) without an
// extra client-side round trip before the form is usable.
export default async function NewPropertyPage() {
  const profile = await requireProfile();

  // An assistant sets a file up ON BEHALF OF an agent, so they have to say
  // which one. Without this the listing would be created against the
  // assistant, and it would never appear as the agent's own work — not in
  // their listings, not in "waiting for your review", not in the digest.
  // The agent is the owner of the file; the assistant is who did the typing,
  // and that is already recorded item by item in completed_by.
  let agents: Profile[] = [];
  if (profile.is_assistant) {
    const supabase = await createClient();
    // Two plain queries rather than an embedded join: PostgREST types the
    // embedded row as an array, and the cast needed to convince TypeScript
    // otherwise is exactly the kind of thing that hides a real shape change.
    const { data: linkRows } = await supabase
      .from("assistant_agents")
      .select("agent_id")
      .eq("assistant_id", profile.id);
    const agentIds = ((linkRows ?? []) as { agent_id: string }[]).map((r) => r.agent_id);
    if (agentIds.length > 0) {
      const { data: agentRows } = await supabase
        .from("profiles")
        .select("*")
        .in("id", agentIds)
        .order("full_name", { ascending: true });
      agents = (agentRows ?? []) as Profile[];
    }
  }

  return (
    <>
      <NewPropertyForm agencyId={profile.agency_id} agents={agents} />
    </>
  );
}
