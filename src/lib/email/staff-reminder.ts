import { renderEmailHtml, renderEmailText, DILIGENCE_LINE, type EmailDocument } from "./layout";
import type { ReminderKind } from "@/lib/staff-reminders/outstanding";

// The reminder a licensee or an office manager sends staff who still need to
// sign the SG Manual, or read and tick the annexure and the Supervision
// Guidelines (Adam, 26 Oct 2026; 0093), or sign a change to the supervision
// guidelines (0125; 0126). One email per person, listing
// everything they still need to do. Reply-to is the person who sent it.

export type StaffReminderEmail = {
  recipientName: string;
  senderName: string;
  /** "licensee in charge" or "office manager". */
  senderRole: string;
  officeName: string;
  kinds: ReminderKind[];
  /** The current SG Manual version's label, where there is one. */
  sgVersionLabel: string | null;
  /** The changes still to sign, "A2", "A3", for sg_change_sign. */
  changeRefs?: string[];
  /** The app's address, e.g. https://www.realcomply.com.au */
  appUrl: string;
};

export function staffReminderSubject(input: Pick<StaffReminderEmail, "kinds" | "officeName">): string {
  const manual = input.kinds.includes("sg_manual_sign");
  const change = input.kinds.includes("sg_change_sign");
  const read = input.kinds.includes("sg_read");
  if ((manual || change) && read) return `Please sign and read ${input.officeName}'s Supervision Guidelines`;
  if (manual) return `Please sign ${input.officeName}'s Supervision Guidelines Manual`;
  if (change) return `Please sign the changes to ${input.officeName}'s Supervision Guidelines`;
  return `Please read ${input.officeName}'s Supervision Guidelines`;
}

export function staffReminderDocument(input: StaffReminderEmail): EmailDocument {
  const rows = [];
  if (input.kinds.includes("sg_manual_sign")) {
    rows.push({
      title: "Sign the Supervision Guidelines Manual",
      sub: input.sgVersionLabel ?? undefined,
      detail: "On the SG Manual page in RealComply.",
      tone: "attention" as const,
    });
  }
  if (input.kinds.includes("sg_change_sign")) {
    rows.push({
      title: "Sign the changes to the supervision guidelines",
      sub: input.changeRefs && input.changeRefs.length > 0 ? input.changeRefs.join(", ") : undefined,
      detail: "The card on your Home page in RealComply: \"I've read and understood this change\".",
      tone: "attention" as const,
    });
  }
  if (input.kinds.includes("sg_read")) {
    rows.push({
      title: "Read the RealComply annexure and your Supervision Guidelines, then tick to confirm",
      detail: "The card on your Home page in RealComply.",
      tone: "attention" as const,
    });
  }
  const href = `${input.appUrl}${input.kinds.includes("sg_manual_sign") ? "/dashboard/sg-manual" : "/dashboard/home"}`;
  return {
    preheader: `${input.senderName} has asked you to ${
      input.kinds.includes("sg_read") && input.kinds.length > 1 ? "sign and read" : input.kinds.includes("sg_read") ? "read" : "sign"
    } ${input.officeName}'s Supervision Guidelines.`,
    title: "Your Supervision Guidelines",
    meta: input.officeName,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text: `Hi ${input.recipientName}, ${input.senderName}, ${input.senderRole} at ${input.officeName}, has asked you to:`,
      },
      { kind: "rows", rows },
      { kind: "button", label: "Open RealComply", href },
      {
        kind: "note",
        text: "Sign in with your RealComply login. If you've already done this, you can ignore this email. Reply to this email with any questions.",
      },
    ],
    footer: [`Sent by ${input.officeName} through RealComply.`, DILIGENCE_LINE],
  };
}

export function buildStaffReminderEmail(input: StaffReminderEmail): { subject: string; text: string; html: string } {
  const doc = staffReminderDocument(input);
  return { subject: staffReminderSubject(input), text: renderEmailText(doc), html: renderEmailHtml(doc) };
}
