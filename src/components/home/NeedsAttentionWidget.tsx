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

// The licensee's version links to the Office overview. An agent's version
// (Adam, 7 Oct 2026: an agent's Home is their own work) links to Listings,
// which the agent can open, and its count is their own to-dos.
export function NeedsAttentionWidget({
  items,
  scope = "office",
}: {
  items: NeedsAttentionItem[];
  scope?: "office" | "own";
}) {
  const own = scope === "own";
  return (
    <WidgetCard
      icon={ClipboardList}
      title="Needs your attention"
      href={own ? "/dashboard" : "/dashboard/portfolio"}
      hrefLabel={own ? "Listings" : "Office overview"}
      metric={items.length}
      caption={
        items.length === 0
          ? own
            ? "No listings need anything right now"
            : "Nothing pending across the portfolio"
          : own
            ? "listings with something to do"
            : "files awaiting sign-off or with open flags"
      }
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
            <li className="px-3 py-2 text-xs text-neutral-400">
              +{items.length - 5} more on the {own ? "Listings" : "Office overview"} page →
            </li>
          )}
        </ul>
      )}
    </WidgetCard>
  );
}
