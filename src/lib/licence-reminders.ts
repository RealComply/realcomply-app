// Licence / certificate-of-registration expiry reminders — the scheduling
// logic, kept separate from the sending so it can be reasoned about (and
// read by the UI) without touching email.
//
// Adam, 18 Aug 2026: "note the expiry date and set up reminders for each
// agent and for the principal or licensee so that they're aware of when
// licences are going to expire."
//
// Thresholds are 90 / 30 / 7 / 0 days. Ninety days is the number Adam asked
// for on 15 Aug ("reminders for three months prior to expiry"), and it is
// also the practical one: NSW Fair Trading renewals want doing well before
// the day, and a Class 2 holder moving to Class 1 needs longer still. The
// 30 and 7 day nudges exist because a single reminder three months out is a
// reminder you forget, and the 0 entry catches the day itself.
//
// Deliberately NOT a renewal service. RealComply tells the holder the date is
// coming; the holder renews with Fair Trading. Same posture as everywhere
// else in the product — diligence support, the licensee decides.

import type { LicenceType } from "@/lib/types";

export const REMINDER_THRESHOLDS = [90, 30, 7, 0] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];

export function daysUntil(dateStr: string, today: Date = new Date()): number {
  const expiry = new Date(`${dateStr}T00:00:00Z`);
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return Math.round((expiry.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));
}

// The threshold that should fire today, or null if none should.
//
// Picks the MOST URGENT threshold the date has already passed, not every
// threshold it has passed. That matters when a licence is entered into the
// register late — someone adding a certificate that expires in three weeks
// should get the 30-day reminder once, not the 90 and the 30 together in the
// same minute, which reads as a broken system rather than a diligent one.
export function dueThreshold(expiry: string, today: Date = new Date()): ReminderThreshold | null {
  const days = daysUntil(expiry, today);
  const applicable = REMINDER_THRESHOLDS.filter((t) => days <= t).sort((a, b) => a - b);
  return applicable[0] ?? null;
}

// The next date a reminder is scheduled for, so the register can show it.
// Returns null once every threshold has passed — there is nothing further to
// promise, and the expired badge is doing the talking by then.
export function nextReminderDate(expiry: string, today: Date = new Date()): string | null {
  const days = daysUntil(expiry, today);
  const upcoming = REMINDER_THRESHOLDS.filter((t) => t < days).sort((a, b) => b - a)[0];
  if (upcoming === undefined) return null;
  const expiryDate = new Date(`${expiry}T00:00:00Z`);
  expiryDate.setUTCDate(expiryDate.getUTCDate() - upcoming);
  return expiryDate.toISOString().slice(0, 10);
}

// What to call the thing that is expiring. A certificate of registration is
// not a licence and assistant agents know the difference, so an email that
// calls it the wrong thing reads as a mail-merge rather than as their office
// looking out for them.
export function credentialLabel(type: LicenceType | null): string {
  switch (type) {
    case "class_1":
      return "Class 1 licence";
    case "class_2":
      return "Class 2 licence";
    case "certificate_of_registration":
      return "certificate of registration";
    default:
      return "licence";
  }
}

// "in 90 days" / "in 7 days" / "today" / "5 days ago" — used in subject lines
// and in the register, so it is worth having one version of it.
export function expiryPhrase(days: number): string {
  if (days > 1) return `in ${days} days`;
  if (days === 1) return "tomorrow";
  if (days === 0) return "today";
  if (days === -1) return "yesterday";
  return `${Math.abs(days)} days ago`;
}
