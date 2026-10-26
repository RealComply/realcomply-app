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
//
// AN OFFICE RUN LIKE AN AGENT PLAN (Adam, 26 Oct 2026; 0092). Found live at
// Raine & Horne Queanbeyan: the person who signed up answered "No, someone
// else" to "Are you the licensee in charge?", then chose an office plan, and
// nobody in the office had the licensee's powers. Now an office plan behaves
// exactly like an agent plan when the person signing up isn't the licensee
// in charge: they run the account, and the licensee signs by email link. The
// office carries licensee_not_on_realcomply; worksAsAgentPlan() below is the
// one test, the same as works_as_agent_plan() in the database, and every rule
// that asked "is this an agent plan?" asks it instead.

export type Access = {
  /** Licensee in charge, or the agent on an agent plan. Office overview, Team, Trust, deletes, agency details. */
  actsAsLicensee: boolean;
  /** Licensee in charge of an office (not an agent plan). The complaints register. */
  officeLicensee: boolean;
  /** Prepares files for the agents they assist. Cannot sign. */
  isAssistant: boolean;
  /** On an agent plan, or an office run like one (0092): the paying customer, so gets Billing. */
  worksAsAgentPlan: boolean;
};

/** What the access rules need from the agency row. */
export type AgencyFooting = { plan?: string | null; licensee_not_on_realcomply?: boolean | null };

/**
 * An agent plan, or an office whose licensee in charge isn't on RealComply,
 * run by the person who signed up the way an agent on their own plan runs
 * theirs (0092). Same as works_as_agent_plan() in the database.
 */
export function worksAsAgentPlan(agency: AgencyFooting | null | undefined): boolean {
  const plan = agency?.plan;
  return (typeof plan === "string" && plan.startsWith("agent_")) || agency?.licensee_not_on_realcomply === true;
}

export function accessFrom(
  profile: { is_licensee_in_charge: boolean | null; is_assistant: boolean | null; archived_at?: string | null },
  agency: AgencyFooting | null | undefined,
): Access {
  const active = !profile.archived_at;
  const agentPlan = worksAsAgentPlan(agency);
  const licensee = active && profile.is_licensee_in_charge === true;
  return {
    // Not an assistant on an agent plan: the agent is the licensee for their
    // own account, the person helping them is not (0059).
    actsAsLicensee: licensee || (active && agentPlan && profile.is_assistant !== true),
    officeLicensee: licensee && !agentPlan,
    isAssistant: active && profile.is_assistant === true,
    worksAsAgentPlan: agentPlan,
  };
}
