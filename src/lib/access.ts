// Who may see and do what. The app's half of the rules in migration 0058.
//
// REVERSAL (Adam, 7 Oct 2026). Was: every member of an office saw and changed
// the whole office. Now an agent sees only their own work, an assistant the
// work of the agents they assist, and the licensee in charge everything. The
// database rules are the ones that count; this file decides what the menu
// shows and which pages refuse a typed address, so the two must agree.
//
// "Acts as licensee" is the licensee in charge, or the one agent on an agent
// plan, who is the licensee for their own account (Adam, 9 Oct) — except for
// complaints, which only the licensee in charge of an office has, even for
// an agent on their own plan (REVERSAL, Adam, 9 Oct: "Complaints should go
// directly to a licensee"). Same as acts_as_licensee() and
// is_office_licensee() in 0058.

export type Access = {
  /** Licensee in charge, or the agent on an agent plan. Office overview, Team, Trust, deletes, agency details. */
  actsAsLicensee: boolean;
  /** Licensee in charge of an office (not an agent plan). The complaints register. */
  officeLicensee: boolean;
  /** Prepares files for the agents they assist. Cannot sign. */
  isAssistant: boolean;
  /** On an agent plan: the paying customer, so gets Billing. */
  isAgentPlan: boolean;
};

export function accessFrom(
  profile: { is_licensee_in_charge: boolean | null; is_assistant: boolean | null; archived_at?: string | null },
  plan: string | null | undefined,
): Access {
  const active = !profile.archived_at;
  const isAgentPlan = typeof plan === "string" && plan.startsWith("agent_");
  const licensee = active && profile.is_licensee_in_charge === true;
  return {
    actsAsLicensee: licensee || (active && isAgentPlan),
    officeLicensee: licensee && !isAgentPlan,
    isAssistant: active && profile.is_assistant === true,
    isAgentPlan,
  };
}
