// What the Office profile says about the licensee email (Master, 4 Nov 2026;
// 0112). Pure, so every line is tested.
//
//   * Confirm first: until the address confirms it is the licensee in
//     charge's, no approval, invite or sign-off link goes to it. The page
//     says "Waiting for [address] to confirm", with Send again.
//   * The address that is the licensee in charge's own RealComply login needs
//     no confirming.
//   * Every kind of link sent to the licensee: "last sent to [address] on
//     [date]", so whoever is waiting on a signature can spot a wrong address.

export type LicenseeEmailState =
  | { kind: "none" }
  | { kind: "login"; email: string }
  | { kind: "confirmed"; email: string; confirmedAt: string }
  | { kind: "waiting"; email: string; lastSentAt: string | null; sendError: string | null };

export type ConfirmationRow = {
  email: string;
  last_sent_at: string | null;
  last_send_error: string | null;
  confirmed_at: string | null;
};

export function licenseeEmailState(input: {
  email: string | null | undefined;
  /** licensee_email_confirmed(): the licensee's own login, or confirmed. */
  accepted: boolean;
  /** The current (not superseded) confirmation for this address, if any. */
  confirmation: ConfirmationRow | null;
}): LicenseeEmailState {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email) return { kind: "none" };
  const row = input.confirmation && input.confirmation.email === email ? input.confirmation : null;
  if (row?.confirmed_at) return { kind: "confirmed", email, confirmedAt: row.confirmed_at };
  if (input.accepted) return { kind: "login", email };
  return { kind: "waiting", email, lastSentAt: row?.last_sent_at ?? null, sendError: row?.last_send_error ?? null };
}

/** The one line that says where the address stands. */
export function licenseeEmailLine(state: LicenseeEmailState, formatDate: (iso: string) => string): string {
  switch (state.kind) {
    case "none":
      return "No licensee email yet. Nothing can be sent to your licensee until there is one.";
    case "login":
      return `${state.email} is your licensee in charge's own RealComply login, so it doesn't need confirming.`;
    case "confirmed":
      return `Confirmed by ${state.email} on ${formatDate(state.confirmedAt)}.`;
    case "waiting":
      return `Waiting for ${state.email} to confirm.`;
  }
}

/** Under "Waiting": when the confirm email went, or that it hasn't. */
export function waitingSentLine(state: Extract<LicenseeEmailState, { kind: "waiting" }>, formatDate: (iso: string) => string): string {
  if (state.sendError && !state.lastSentAt) return "The confirm email couldn't be sent. Send it again.";
  if (!state.lastSentAt) return "The confirm email hasn't been sent yet.";
  return `Confirm email last sent on ${formatDate(state.lastSentAt)}. If it hasn't arrived, ask them to check their spam or junk folder.`;
}

/** What approval, invite and sign-off links wait for, said once on the page. */
export const CONFIRM_FIRST_NOTE =
  "No approval, invite or sign-off link goes to your licensee until this address confirms. Your office is responsible for it being your licensee's address.";

export type LinkSend = { kind: string; sent_to: string; sent_at: string };

const SEND_LABEL: Record<string, string> = {
  confirm: "Confirm email",
  file_signoff: "File sign-off link",
  office_manager: "Office manager approval",
  annexure: "SG annexure to adopt",
  licensee_invite: "Invite to join RealComply",
};

/** "last sent to [address] on [date]", one line per kind, in a fixed order. */
export function linkSendLines(rows: LinkSend[], formatDate: (iso: string) => string): string[] {
  const order = Object.keys(SEND_LABEL);
  return rows
    .filter((r) => SEND_LABEL[r.kind] && r.sent_to && r.sent_at)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((r) =>
      r.kind === "licensee_invite"
        ? `${SEND_LABEL[r.kind]}: made for ${r.sent_to} on ${formatDate(r.sent_at)} (you send this one yourself)`
        : `${SEND_LABEL[r.kind]}: last sent to ${r.sent_to} on ${formatDate(r.sent_at)}`,
    );
}
