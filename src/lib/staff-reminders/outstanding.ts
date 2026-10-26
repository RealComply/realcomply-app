// Who still needs to sign the current SG Manual, or read and tick the
// annexure and the Supervision Guidelines, for the reminder emails the
// licensee or an office manager sends (Adam, 26 Oct 2026; 0093). Pure, so
// every case is tested.
//
//   sg_manual_sign  Asked to sign the current SG Manual version (an unsigned
//                   row on it) and hasn't.
//   sg_read         An agent in an office that has adopted the annexure who
//                   hasn't confirmed reading that version. The same people
//                   the Home card asks (lib/sg-annexure/office-read.ts):
//                   not the licensee in charge, not an assistant.
//
// Never the person sending, and never anyone who has left.

export type ReminderKind = "sg_manual_sign" | "sg_read";

export type ReminderPerson = {
  id: string;
  full_name: string | null;
  email: string;
  is_agent: boolean;
  is_assistant: boolean;
  is_licensee_in_charge: boolean;
  archived_at: string | null;
};

export type StillToDo = { person: ReminderPerson; kinds: ReminderKind[]; lastRemindedAt: string | null };

export function staffStillToDo(input: {
  staff: ReminderPerson[];
  senderId: string;
  /** The current all-staff SG Manual sign-off, if there is one. */
  currentSgDocumentId: string | null;
  signatures: Array<{ document_id: string; signer_id: string; signed_at: string | null }>;
  /** The annexure version the office adopted, if it has. */
  adoptedVersion: string | null;
  readConfirmations: Array<{ confirmed_by: string | null; annexure_version: string }>;
  /** Newest first. */
  reminders: Array<{ profile_id: string; created_at: string }>;
}): StillToDo[] {
  const out: StillToDo[] = [];
  for (const person of input.staff) {
    if (person.archived_at || person.id === input.senderId) continue;
    const kinds: ReminderKind[] = [];
    if (
      input.currentSgDocumentId &&
      input.signatures.some(
        (s) => s.document_id === input.currentSgDocumentId && s.signer_id === person.id && !s.signed_at,
      )
    ) {
      kinds.push("sg_manual_sign");
    }
    if (
      input.adoptedVersion &&
      person.is_agent &&
      !person.is_assistant &&
      !person.is_licensee_in_charge &&
      !input.readConfirmations.some(
        (c) => c.confirmed_by === person.id && c.annexure_version === input.adoptedVersion,
      )
    ) {
      kinds.push("sg_read");
    }
    if (kinds.length > 0) {
      const last = input.reminders.find((r) => r.profile_id === person.id)?.created_at ?? null;
      out.push({ person, kinds, lastRemindedAt: last });
    }
  }
  return out;
}

/** Whether a reminder can go now: none in the last 20 hours (the database decides; this only greys the button). */
export function remindableNow(lastRemindedAt: string | null, now: Date): boolean {
  return !lastRemindedAt || now.getTime() - new Date(lastRemindedAt).getTime() >= 20 * 3_600_000;
}
