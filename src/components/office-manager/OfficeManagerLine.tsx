import Link from "next/link";
import type { OfficeManagerLine } from "@/lib/office-manager/card";
import { formatAuDayMonth } from "@/lib/format-date";

// The small line at the top of Home once the office manager card has been
// seen (0096; mockup approved by Adam, 26 Oct 2026). Small grey text, no
// card. On a phone the approver's name is left out to keep it to one line.
export function OfficeManagerLines({ lines }: { lines: OfficeManagerLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="mb-1 space-y-0.5">
      {lines.map((line) => (
        <p key={`${line.personName}-${line.approvedAt}`} className="text-xs text-rc-muted">
          Office manager: {line.personName} · approved
          <span className="hidden sm:inline"> by {line.approvedByName},</span> {formatAuDayMonth(line.approvedAt)} ·{" "}
          <Link href="/dashboard/team" className="font-semibold text-rc-green-deep hover:underline">
            Team
          </Link>
        </p>
      ))}
    </div>
  );
}
