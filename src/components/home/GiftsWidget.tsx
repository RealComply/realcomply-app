import Link from "next/link";
import { Gift as GiftIcon } from "lucide-react";
import { WidgetCard, BreakdownRow } from "./WidgetCard";

export function GiftsWidget({
  total,
  flagged,
  reviewed,
  recorded,
}: {
  total: number;
  flagged: number;
  reviewed: number;
  recorded: number;
}) {
  return (
    <WidgetCard
      icon={GiftIcon}
      title="Gifts & benefits"
      href="/dashboard/registers?tab=gifts"
      hrefLabel="Registers →"
      metric={total}
      caption="on file"
      tone={flagged > 0 ? "warn" : "ok"}
      ring={[
        { value: reviewed, colorVar: "var(--rc-green-deep)" },
        { value: flagged, colorVar: "var(--rc-amber)" },
        { value: recorded, colorVar: "#c9d2ce" },
      ]}
    >
      <BreakdownRow dot="amber" label="Awaiting review" count={flagged} />
      <BreakdownRow dot="green" label="Reviewed" count={reviewed} />
      <BreakdownRow dot="neutral" label="Under threshold" count={recorded} />
      {/* Every agent can already log a gift against themselves from the Gift
          register tab — this was just hard to find (buried behind
          "Registers", which reads as a licensee-only page). Jumps straight
          to a ready-to-fill form instead of making an agent find the tab and
          the "+ Record a gift / benefit" toggle themselves. */}
      <Link
        href="/dashboard/registers?tab=gifts&add=1"
        className="mt-2 inline-block text-xs font-medium text-rc-green-deep hover:underline"
      >
        + Log a gift
      </Link>
    </WidgetCard>
  );
}
