// The annual review of the supervision guidelines (Adam's mockup, signed off
// 6 Nov 2026, screen 7; Master, 10 Nov 2026; 0126). Fair Trading's
// Supervision Guidelines 2.1.2: operational procedures "should be reviewed
// and appropriately revised at least every 12 months".
//
// The next review is due 12 months after the latest of the office's sign-up,
// a version saved, an amendment approved, or "Reviewed, no changes needed"
// (lib/sg-document/change-log.ts nextReviewDue). From 90 days before it, the
// licensee in charge and every office manager see a card on Home, and are
// emailed at 90, 60, 30, 14 and 7 days. Any of the three things on the card
// moves the date 12 months on, which stops the card and the emails.
//
// Pure, so every case is tested. Days are Sydney's.

/** Days before the review is due that an email goes (the mockup; 0126's check says the same). */
export const REVIEW_REMINDER_DAYS = [90, 60, 30, 14, 7] as const;
export type ReviewReminderDay = (typeof REVIEW_REMINDER_DAYS)[number];

/** The schedule in words, for the card. */
export const REVIEW_SCHEDULE_WORDS = "90, 60, 30, 14 and 7 days";

/** Whole days from one YYYY-MM-DD to another: negative once the day has passed. */
export function daysUntil(dueIso: string, todayIso: string): number {
  const a = Date.parse(`${todayIso}T00:00:00Z`);
  const b = Date.parse(`${dueIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * The reminder that goes today, or null. The most urgent step already
 * reached, as the licence reminders do (lib/licence-reminders.ts
 * dueThreshold): a date first worked out 20 days ahead gets the 30-day email
 * once, not the 90, 60 and 30 together. Each step goes once (0126's unique
 * index), so a review left overdue gets no more after the 7-day one.
 */
export function reviewReminderDay(dueIso: string, todayIso: string): ReviewReminderDay | null {
  const days = daysUntil(dueIso, todayIso);
  const reached = REVIEW_REMINDER_DAYS.filter((d) => days <= d);
  return reached.length > 0 ? reached[reached.length - 1] : null;
}

/** Whether the Home card shows: from 90 days before, and until it's done. */
export function reviewCardShows(dueIso: string | null, todayIso: string): boolean {
  return dueIso !== null && daysUntil(dueIso, todayIso) <= REVIEW_REMINDER_DAYS[0];
}

/** The card's tag: "Due in 30 days", "Due tomorrow", "Due today", "Overdue by 3 days". */
export function reviewDueTag(days: number): string {
  if (days > 1) return `Due in ${days} days`;
  if (days === 1) return "Due tomorrow";
  if (days === 0) return "Due today";
  return `Overdue by ${-days} ${days === -1 ? "day" : "days"}`;
}

/** For an email: "in 30 days", "tomorrow", "today", "3 days ago". */
export function reviewWhenSaid(days: number): string {
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  return `${-days} ${days === -1 ? "day" : "days"} ago`;
}

// ── "Reviewed, no changes needed" (0126 sg_reviews) ──────────────────────

export type SgReview = {
  id: string;
  documentId: string;
  note: string | null;
  reviewedByName: string | null;
  reviewedAs: "licensee" | "office_manager";
  reviewedAt: string;
};

export function reviewFrom(row: Record<string, unknown>): SgReview | null {
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const id = s(row.id);
  const documentId = s(row.document_id);
  const reviewedAt = s(row.reviewed_at);
  const as = row.reviewed_as;
  if (!id || !documentId || !reviewedAt || (as !== "licensee" && as !== "office_manager")) return null;
  return {
    id,
    documentId,
    note: s(row.note)?.trim() || null,
    reviewedByName: s(row.reviewed_by_name)?.trim() || null,
    reviewedAs: as,
    reviewedAt,
  };
}

/** The note as it's kept: plain text on one line, at most 1,000 characters (0126 says the same). */
export const REVIEW_NOTE_MAX = 1000;
export function reviewNoteProblem(note: string): string | null {
  return note.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().length > REVIEW_NOTE_MAX ? "Keep the note to 1,000 characters." : null;
}

// ── Who is reminded ──────────────────────────────────────────────────────

export type ReviewPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_licensee_in_charge: boolean | null;
  is_assistant: boolean | null;
  archived_at: string | null;
};

/**
 * Whoever runs the office, as the database decides it (runs_office(): 0092,
 * 0093, 0115): the licensee in charge; on an agent plan, or where the
 * licensee isn't on RealComply, each person who isn't an assistant; an
 * approved office manager (never on an agent plan); and someone keeping the
 * office side until the licensee approves. Never anyone who has left, or
 * anyone with no email.
 */
export function reviewRecipients(input: {
  plan: string | null;
  licenseeNotOnRealcomply: boolean;
  people: ReviewPerson[];
  /** office_managers rows: withdrawn or not. */
  officeManagers: Array<{ profileId: string; approvedAt: string | null; withdrawnAt: string | null }>;
  /** office_access_until_licensee rows (0115). */
  keepsAccess: Array<{ profileId: string; startedAt: string }>;
}): Array<{ id: string; name: string; email: string; role: "licensee" | "office_manager" }> {
  const agentPlan = (input.plan ?? "").startsWith("agent_");
  const worksAsAgentPlan = agentPlan || input.licenseeNotOnRealcomply;
  const active = input.people.filter((p) => !p.archived_at);
  const hasLicensee = active.some((p) => p.is_licensee_in_charge === true);
  const out: Array<{ id: string; name: string; email: string; role: "licensee" | "office_manager" }> = [];
  for (const p of active) {
    const email = p.email?.trim();
    if (!email) continue;
    const actsAsLicensee = p.is_licensee_in_charge === true || (worksAsAgentPlan && p.is_assistant !== true);
    const approved =
      !agentPlan && input.officeManagers.some((m) => m.profileId === p.id && !m.withdrawnAt);
    const keeps =
      !agentPlan &&
      p.is_licensee_in_charge !== true &&
      p.is_assistant !== true &&
      !hasLicensee &&
      input.keepsAccess.some(
        (k) =>
          k.profileId === p.id &&
          !input.officeManagers.some(
            (m) => m.profileId === p.id || (m.approvedAt !== null && Date.parse(m.approvedAt) >= Date.parse(k.startedAt)),
          ),
      );
    if (actsAsLicensee || approved || keeps) {
      out.push({ id: p.id, name: p.full_name?.trim() || email, email, role: actsAsLicensee ? "licensee" : "office_manager" });
    }
  }
  return out;
}
