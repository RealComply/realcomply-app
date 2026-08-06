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
      href="/dashboard/registers"
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
    </WidgetCard>
  );
}
