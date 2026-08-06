import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for every Home dashboard widget. Deliberately dumb/presentational
// — all data-shaping happens in the page — so each widget is a self-contained
// grid item. That's the seam a future drag-and-drop layout would hang off:
// swap the static grid in page.tsx for a reorderable one and these components
// don't need to change. See the "1 and 3" scoping answer (fixed layout first,
// architected to evolve into full drag-and-drop).
export function WidgetCard({
  icon,
  title,
  href,
  hrefLabel = "View →",
  metric,
  caption,
  tone = "neutral",
  children,
  className = "",
}: {
  icon: string;
  title: string;
  href?: string;
  hrefLabel?: string;
  metric?: string | number;
  caption?: string;
  tone?: "neutral" | "warn" | "ok" | "danger";
  children?: ReactNode;
  className?: string;
}) {
  const metricColor =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-rc-amber-deep"
        : tone === "ok"
          ? "text-rc-green-deep"
          : "text-rc-ink";

  return (
    <div className={`flex flex-col rounded-lg border border-rc-border bg-white p-4 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{icon}</span>
          <h3 className="text-sm font-semibold text-rc-ink">{title}</h3>
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-xs text-neutral-400 hover:text-rc-green-deep hover:underline">
            {hrefLabel}
          </Link>
        )}
      </div>

      {metric !== undefined && (
        <div className="mt-3">
          <div className={`text-2xl font-bold ${metricColor}`}>{metric}</div>
          {caption && <div className="mt-0.5 text-xs text-neutral-500">{caption}</div>}
        </div>
      )}

      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function BreakdownRow({
  dot,
  label,
  count,
}: {
  dot: "red" | "amber" | "green" | "neutral";
  label: string;
  count: number;
}) {
  const dotColor = {
    red: "bg-red-500",
    amber: "bg-rc-amber",
    green: "bg-rc-green-deep",
    neutral: "bg-neutral-300",
  }[dot];
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="flex items-center gap-1.5 text-neutral-600">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        {label}
      </span>
      <span className="font-medium text-rc-ink">{count}</span>
    </div>
  );
}

export function StatTile({ n, l, tone = "neutral" }: { n: number | string; l: string; tone?: "neutral" | "warn" | "ok" }) {
  const color = tone === "warn" ? "text-rc-amber-deep" : tone === "ok" ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div className="rounded-lg border border-rc-border bg-white p-3">
      <div className={`text-xl font-bold ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{l}</div>
    </div>
  );
}
