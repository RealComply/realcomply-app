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
// OFFICE MANAGER (Adam, 26 Oct 2026; 0093). Someone the licensee in charge
// approves gets the office side: Team, Office profile, registers, CPD,
// training, trust records, the SG Manual and billing ("runs the office",
// runs_office() in the database). Price statement approvals, file sign-offs,
// annexure adoption, changing the licensee in charge and deleting compliance
// records stay with the licensee (actsAsLicensee). Office overview and the
// complaints register are not decided yet, so they stay with the licensee.

export type Access = {
  /** Licensee in charge, or the agent on an agent plan. Office overview, Team, Trust, deletes, agency details. */
  actsAsLicensee: boolean;
  /** Licensee in charge of an office (not an agent plan). The complaints register. */
  officeLicensee: boolean;
  /** Prepares files for the agents they assist. Cannot sign. */
  isAssistant: boolean;
  /** On an agent plan: the paying customer, so gets Billing. */
  isAgentPlan: boolean;
  /** The licensee's side of the office, or an office manager's (0093). Team, registers, trust, billing. */
  runsOffice: boolean;
  /** Approved by the licensee in charge as office manager (0093). Never on an agent plan. */
  isOfficeManager: boolean;
};

export function accessFrom(
  profile: { is_licensee_in_charge: boolean | null; is_assistant: boolean | null; archived_at?: string | null },
  plan: string | null | undefined,
  officeManager = false,
): Access {
  const active = !profile.archived_at;
  const isAgentPlan = typeof plan === "string" && plan.startsWith("agent_");
  const licensee = active && profile.is_licensee_in_charge === true;
  // Not an assistant on an agent plan: the agent is the licensee for their
  // own account, the person helping them is not (0059).
  const actsAsLicensee = licensee || (active && isAgentPlan && profile.is_assistant !== true);
  // Same as is_office_manager(): approved, still in the office, an office plan.
  const isOfficeManager = active && !isAgentPlan && officeManager;
  return {
    actsAsLicensee,
    officeLicensee: licensee && !isAgentPlan,
    isAssistant: active && profile.is_assistant === true,
    isAgentPlan,
    runsOffice: actsAsLicensee || isOfficeManager,
    isOfficeManager,
  };
}
