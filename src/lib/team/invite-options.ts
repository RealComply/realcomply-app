// Which roles the Team invite offers, and to whom (0095; mockup approved by
// Adam, 26 Oct 2026). Pure, so every case is tested. The database checks the
// same rules (guard_agency_invite_roles); this only decides what the form
// shows and says.
//
//   Agent, Assistant   anyone who may invite (the licensee, or an office
//                      manager).
//   Licensee in charge an office manager, while the office's licensee in
//                      charge isn't on RealComply: the licensee named in
//                      Office profile, at that email, exactly as recorded.
//                      Where the licensee is on RealComply, handing over
//                      stays Change licensee in charge (Adam, 16 Oct 2026).
//   Office manager     the licensee in charge only, with a login, not on an
//                      agent plan.
//   Property manager   anyone who may invite, on a plan with property
//                      management.
//
// REVERSAL (Adam, 26 Oct 2026). Was (0093, the same day): an office manager
// can't invite a licensee in charge. Now they can invite the one named in
// Office profile, and no one else.

export type InviteRole = "agent" | "assistant" | "licensee_in_charge" | "office_manager" | "property_manager";

export type InviteOptionsInput = {
  isLicensee: boolean;
  isOfficeManager: boolean;
  isAgentPlan: boolean;
  /** The office's licensee in charge has a RealComply login. */
  officeHasLicenseeLogin: boolean;
  pmEnabled: boolean;
  /** As recorded in Office profile. */
  licenseeName: string | null;
  licenseeEmail: string | null;
};

export type InviteOption = {
  role: InviteRole;
  label: string;
  /** Under the label on its tile. */
  hint: string;
  available: boolean;
  /** Why it can't be chosen, shown under the tiles. */
  note?: string;
};

export function inviteOptions(input: InviteOptionsInput): InviteOption[] {
  const options: InviteOption[] = [
    { role: "agent", label: "Agent", hint: "Own listings. Signs their own files.", available: true },
    { role: "assistant", label: "Assistant", hint: "Prepares files for one or more agents.", available: true },
  ];
  // An agent plan has no licensee in charge or office manager to invite.
  if (input.isAgentPlan) return options;

  const licenseeName = input.licenseeName?.trim() || null;
  const licenseeEmail = input.licenseeEmail?.trim() || null;
  if (input.isLicensee || input.officeHasLicenseeLogin) {
    options.push({
      role: "licensee_in_charge",
      label: "Licensee in charge",
      hint: "Hand over in Office profile.",
      available: false,
      note: input.isLicensee
        ? "You’re the licensee in charge. To hand over, invite the new licensee as an agent. Once their class 1 licence is on file, use Change licensee in charge in Office profile. That records the handover and moves sign-offs and billing with it."
        : "Your licensee in charge is already on RealComply. Handing over is theirs to do, in Office profile.",
    });
  } else if (!licenseeEmail) {
    options.push({
      role: "licensee_in_charge",
      label: "Licensee in charge",
      hint: "No email in Office profile.",
      available: false,
      note: "There’s no licensee email in Office profile. Email admin@realcomply.com.au to add it.",
    });
  } else {
    options.push({
      role: "licensee_in_charge",
      label: "Licensee in charge",
      hint: `${licenseeName ?? licenseeEmail}, as in Office profile.`,
      available: input.isOfficeManager,
    });
  }

  options.push(
    input.isLicensee
      ? { role: "office_manager", label: "Office manager", hint: "Runs the office side for you.", available: true }
      : {
          role: "office_manager",
          label: "Office manager",
          hint: "Only the licensee can choose this.",
          available: false,
          note: input.officeHasLicenseeLogin
            ? "Only the licensee in charge can make someone office manager."
            : `Only the licensee in charge can make someone office manager. Once ${licenseeName ?? "your licensee in charge"} has joined, they can do it in Team.`,
        },
  );

  if (input.pmEnabled) {
    options.push({
      role: "property_manager",
      label: "Property manager",
      hint: "Manages rentals. Can still list sales.",
      available: true,
    });
  }
  return options;
}

/** The role an invite was sent as, in words for Team's list. */
export function inviteRoleLabel(invite: {
  is_licensee_in_charge: boolean;
  is_assistant: boolean;
  is_office_manager?: boolean | null;
  is_property_manager?: boolean | null;
}): string {
  if (invite.is_licensee_in_charge) return "Licensee in charge";
  if (invite.is_assistant) return "Assistant";
  if (invite.is_office_manager) return "Office manager";
  if (invite.is_property_manager) return "Property manager";
  return "Agent";
}
