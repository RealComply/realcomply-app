// Which office manager card the signed-in person sees on Home (0093; mockup
// approved by Adam, 26 Oct 2026). Pure, so every state is tested.
//
//   ask        The account holder of an office plan whose licensee in charge
//              isn't on RealComply: ask them to approve you as office manager.
//   waiting    Asked, not approved yet.
//   approved   Approved, for two weeks after (then the menu says it).
//   withdrawn  The licensee withdrew it, for two weeks after.
//
// Never on an agent plan (the agent already runs their account), never for
// a licensee in charge, and no "ask" where the licensee is on RealComply:
// they make someone office manager in Team.

export const CARD_DAYS = 14;

export type OfficeManagerRecord = {
  approved_at: string;
  approved_by_name: string;
  approved_via: "team" | "email_link";
  withdrawn_at: string | null;
  withdrawn_via: "team" | "email_link" | "left_office" | null;
  /** Who withdrew it, as recorded. */
  withdrawn_by_name?: string | null;
};

export type OfficeManagerRequest = {
  id: string;
  sent_to: string;
  email_sent_at: string | null;
  email_attempts: number;
  expires_at: string;
};

export type OfficeManagerCardInput = {
  isAgentPlan: boolean;
  isLicensee: boolean;
  isAccountHolder: boolean;
  officeHasLicenseeLogin: boolean;
  licenseeName: string | null;
  licenseeEmail: string | null;
  /** Newest first. */
  records: OfficeManagerRecord[];
  openRequest: OfficeManagerRequest | null;
  now: Date;
};

export type OfficeManagerCard =
  | { kind: "ask"; licenseeName: string; licenseeEmail: string | null }
  | { kind: "waiting"; licenseeName: string; sentTo: string; sentAt: string | null; emailFailed: boolean }
  | { kind: "approved"; licenseeName: string; approvedByName: string; approvedAt: string; viaLink: boolean }
  | { kind: "withdrawn"; licenseeName: string; withdrawnByName: string; withdrawnAt: string; mayAskAgain: boolean };

const within = (iso: string, now: Date, days: number) => now.getTime() - new Date(iso).getTime() < days * 86_400_000;

export function officeManagerCard(input: OfficeManagerCardInput): OfficeManagerCard | null {
  if (input.isAgentPlan || input.isLicensee) return null;
  const licenseeName = input.licenseeName?.trim() || "your licensee in charge";

  const current = input.records.find((r) => r.withdrawn_at === null) ?? null;
  if (current) {
    return within(current.approved_at, input.now, CARD_DAYS)
      ? {
          kind: "approved",
          licenseeName,
          approvedByName: current.approved_by_name,
          approvedAt: current.approved_at,
          viaLink: current.approved_via === "email_link",
        }
      : null;
  }

  const open = input.openRequest && new Date(input.openRequest.expires_at) > input.now ? input.openRequest : null;
  if (open && !input.officeHasLicenseeLogin) {
    return {
      kind: "waiting",
      licenseeName,
      sentTo: open.sent_to,
      sentAt: open.email_sent_at,
      emailFailed: open.email_sent_at === null && open.email_attempts > 0,
    };
  }

  const last = input.records[0];
  if (last?.withdrawn_at && last.withdrawn_via !== "left_office" && within(last.withdrawn_at, input.now, CARD_DAYS)) {
    return {
      kind: "withdrawn",
      licenseeName,
      // The name on the record: where the licensee is on RealComply, the
      // office's licensee name is often blank.
      withdrawnByName: last.withdrawn_by_name?.trim() || input.licenseeName?.trim() || "Your licensee in charge",
      withdrawnAt: last.withdrawn_at,
      mayAskAgain: !input.officeHasLicenseeLogin && input.isAccountHolder,
    };
  }

  if (input.officeHasLicenseeLogin || !input.isAccountHolder) return null;
  return { kind: "ask", licenseeName, licenseeEmail: input.licenseeEmail?.trim() || null };
}

/** The words the licensee approves. The same as office_manager_wording() in 0093. */
export function officeManagerWording(person: string, office: string): string {
  return `I authorise ${person.trim()} to manage ${office.trim()}'s RealComply account as office manager.`;
}
