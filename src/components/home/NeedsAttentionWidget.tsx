import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { WidgetCard } from "./WidgetCard";

export type NeedsAttentionItem = {
  propertyId: string;
  address: string;
  stageLabel: string;
  agentName: string;
  badges: string[];
};

export function NeedsAttentionWidget({ items }: { items: NeedsAttentionItem[] }) {
  return (
    <WidgetCard
      icon={ClipboardList}
      title="Needs your attention"
      href="/dashboard/portfolio"
      hrefLabel="Portfolio →"
      metric={items.length}
      caption={items.length === 0 ? "Nothing pending across the portfolio" : "files awaiting sign-off or with open flags"}
      tone={items.length > 0 ? "warn" : "ok"}
      className="sm:col-span-2"
    >
      {items.length > 0 && (
        <ul className="divide-y divide-rc-border rounded-md border border-rc-border">
          {items.slice(0, 5).map((item) => (
            <li key={item.propertyId} className="px-3 py-2">
              <Link href={`/dashboard/${item.propertyId}`} className="text-sm font-medium text-rc-ink hover:underline">
                {item.address}
              </Link>
              <span className="ml-2 text-xs text-neutral-400">
                {item.stageLabel} · {item.agentName}
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {item.badges.map((b, i) => (
                  <span key={i} className="rounded-full bg-rc-amber/15 px-2 py-0.5 text-[11px] font-medium text-rc-amber-deep">
                    {b}
                  </span>
                ))}
              </div>
            </li>
          ))}
          {items.length > 5 && (
            <li className="px-3 py-2 text-xs text-neutral-400">+{items.length - 5} more on the Portfolio page →</li>
          )}
        </ul>
      )}
    </WidgetCard>
  );
}
