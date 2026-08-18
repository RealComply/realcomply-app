import { BellRing } from "lucide-react";

// The one-line "we'll tell you / we told you" strip that sits under every
// credential in the Licences & certificates register.
//
// Both dates are computed on the server and passed in as finished strings
// (see the note in dashboard/registers/page.tsx) — the cards around this are
// client components, and deriving anything from today's date on both sides of
// a hydration boundary is how you get a mismatch at midnight for no benefit.
//
// This deliberately shows even when nothing has been sent yet. An office that
// can't see the reminders exist keeps its own spreadsheet of expiry dates
// alongside the register, which defeats the point of the register.
export type ReminderInfo = {
  /** ISO date of the next scheduled reminder, or null if none remain. */
  next: string | null;
  /** ISO timestamp of the most recent reminder actually sent, or null. */
  last: string | null;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function ReminderLine({ info, hasExpiry }: { info: ReminderInfo; hasExpiry: boolean }) {
  if (!hasExpiry) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rc-faint">
        <BellRing size={11} /> Add an expiry date to switch reminders on.
      </p>
    );
  }

  const parts: string[] = [];
  if (info.next) parts.push(`Next reminder ${formatDate(info.next)}`);
  else parts.push("All reminders for this date have been sent");
  if (info.last) parts.push(`last sent ${formatDate(info.last)}`);

  return (
    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rc-muted">
      <BellRing size={11} className="text-rc-green-deep" /> {parts.join(" · ")}
    </p>
  );
}
