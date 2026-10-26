// Which office manager card the signed-in person sees on Home (0093; mockup
// approved by Adam, 26 Oct 2026). Pure, so every state is tested.
//
//   ask        The account holder of an office plan whose licensee in charge
//              isn't on RealComply: ask them to approve you as office manager.
//   waiting    Asked, not approved yet.
//   approved   Approved: shown once, with "Got it".
//   withdrawn  The licensee withdrew it: shown once, within two weeks.
//
// Seen once (Adam, 26 Oct 2026, 0096): the approved card was too big once
// seen. After "Got it", or on the next visit to Home, it becomes one small
// grey line at the top of Home ("Office manager: ... · Team") for as long as
// the person is office manager. A withdrawal is shown once, then nothing.
// "Ask" and "Waiting" stay full cards every visit: they need action. Each
// person's "seen" is their own (home_notices_seen), so the licensee in
// charge, if they have a login, sees their own card once too.
//
// Never on an agent plan (the agent already runs their account), never for
// a licensee in charge, and no "ask" where the licensee is on RealComply:
// they make someone office manager in Team.

export const CARD_DAYS = 14;

export type OfficeManagerRecord = {
  id: string;
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
  /** The cards this person has seen (0096). Null when that can't be read: every card is then unseen. */
  seenKeys?: ReadonlySet<string> | null;
  /** The person's own name, for the small line. */
  personName?: string;
};

export type OfficeManagerCard =
  | { kind: "ask"; licenseeName: string; licenseeEmail: string | null }
  | { kind: "waiting"; licenseeName: string; sentTo: string; sentAt: string | null; emailFailed: boolean }
  | {
      kind: "approved";
      licenseeName: string;
      approvedByName: string;
      approvedAt: string;
      viaLink: boolean;
      noticeKey: string;
    }
  | {
      kind: "withdrawn";
      licenseeName: string;
      withdrawnByName: string;
      withdrawnAt: string;
      mayAskAgain: boolean;
      noticeKey: string;
    };

/** The small line at the top of Home once the card has been seen. */
export type OfficeManagerLine = { personName: string; approvedByName: string; approvedAt: string };

/** Which card a home_notices_seen row is about (0096). */
export const approvedNoticeKey = (recordId: string) => `om-approved:${recordId}`;
export const withdrawnNoticeKey = (recordId: string) => `om-withdrawn:${recordId}`;

const within = (iso: string, now: Date, days: number) => now.getTime() - new Date(iso).getTime() < days * 86_400_000;

export function officeManagerCard(input: OfficeManagerCardInput): OfficeManagerCard | null {
  if (input.isAgentPlan || input.isLicensee) return null;
  const licenseeName = input.licenseeName?.trim() || "your licensee in charge";

  const seen = (key: string) => input.seenKeys?.has(key) === true;

  const current = input.records.find((r) => r.withdrawn_at === null) ?? null;
  if (current) {
    const noticeKey = approvedNoticeKey(current.id);
    return within(current.approved_at, input.now, CARD_DAYS) && !seen(noticeKey)
      ? {
          kind: "approved",
          licenseeName,
          approvedByName: current.approved_by_name,
          approvedAt: current.approved_at,
          viaLink: current.approved_via === "email_link",
          noticeKey,
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
    const noticeKey = withdrawnNoticeKey(last.id);
    // Shown once, then nothing for the rest of the two weeks (no "ask again"
    // card straight after a withdrawal, as before).
    if (seen(noticeKey)) return null;
    return {
      kind: "withdrawn",
      licenseeName,
      // The name on the record: where the licensee is on RealComply, the
      // office's licensee name is often blank.
      withdrawnByName: last.withdrawn_by_name?.trim() || input.licenseeName?.trim() || "Your licensee in charge",
      withdrawnAt: last.withdrawn_at,
      mayAskAgain: !input.officeHasLicenseeLogin && input.isAccountHolder,
      noticeKey,
    };
  }

  if (input.officeHasLicenseeLogin || !input.isAccountHolder) return null;
  return { kind: "ask", licenseeName, licenseeEmail: input.licenseeEmail?.trim() || null };
}

/**
 * Home for the office manager (and anyone asking to be one): the card, or,
 * once the "approved" card has been seen, the small line.
 */
export function officeManagerHome(input: OfficeManagerCardInput): {
  card: OfficeManagerCard | null;
  line: OfficeManagerLine | null;
} {
  const card = officeManagerCard(input);
  if (card || input.isAgentPlan || input.isLicensee) return { card, line: null };
  const current = input.records.find((r) => r.withdrawn_at === null);
  return {
    card: null,
    line: current
      ? {
          personName: input.personName?.trim() || "You",
          approvedByName: current.approved_by_name,
          approvedAt: current.approved_at,
        }
      : null,
  };
}

export type OfficeManagerOfOffice = OfficeManagerRecord & {
  profile_id: string;
  approved_by: string | null;
  person_name: string;
};

/** A "now office manager" card on the licensee in charge's Home. */
export type OfficeManagerNews = {
  noticeKey: string;
  personName: string;
  approvedByName: string;
  /** The licensee approved it themselves, in Team. */
  approvedByViewer: boolean;
  approvedAt: string;
  viaLink: boolean;
};

/**
 * Home for the licensee in charge (with a login): once per approval, a card
 * that someone is now office manager; after that, the small line for each
 * current office manager. Never on an agent plan.
 */
export function licenseeOfficeManagerHome(input: {
  isOfficeLicensee: boolean;
  viewerId: string;
  /** Every office manager record in the office, newest first. */
  records: OfficeManagerOfOffice[];
  seenKeys?: ReadonlySet<string> | null;
  now: Date;
}): { cards: OfficeManagerNews[]; lines: OfficeManagerLine[] } {
  if (!input.isOfficeLicensee) return { cards: [], lines: [] };
  const cards: OfficeManagerNews[] = [];
  const lines: OfficeManagerLine[] = [];
  for (const r of input.records) {
    if (r.withdrawn_at !== null) continue;
    const noticeKey = approvedNoticeKey(r.id);
    const approvedByViewer = r.approved_by === input.viewerId;
    if (within(r.approved_at, input.now, CARD_DAYS) && input.seenKeys?.has(noticeKey) !== true) {
      cards.push({
        noticeKey,
        personName: r.person_name,
        approvedByName: r.approved_by_name,
        approvedByViewer,
        approvedAt: r.approved_at,
        viaLink: r.approved_via === "email_link",
      });
    } else {
      lines.push({
        personName: r.person_name,
        approvedByName: approvedByViewer ? "you" : r.approved_by_name,
        approvedAt: r.approved_at,
      });
    }
  }
  return { cards, lines };
}

/** The words the licensee approves. The same as office_manager_wording() in 0093. */
export function officeManagerWording(person: string, office: string): string {
  return `I authorise ${person.trim()} to manage ${office.trim()}'s RealComply account as office manager.`;
}
