import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { DonutRing, type RingSegment } from "@/components/DonutRing";

// Shared shell for every Home dashboard widget. Deliberately dumb/presentational
// — all data-shaping happens in the page — so each widget is a self-contained
// grid item. That's the seam a future drag-and-drop layout would hang off:
// swap the static grid in page.tsx for a reorderable one and these components
// don't need to change. See the "1 and 3" scoping answer (fixed layout first,
// architected to evolve into full drag-and-drop).
export function WidgetCard({
  icon: Icon,
  title,
  href,
  hrefLabel = "View",
  metric,
  caption,
  tone = "neutral",
  ring,
  children,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  href?: string;
  hrefLabel?: string;
  metric?: string | number;
  caption?: string;
  tone?: "neutral" | "warn" | "ok" | "danger";
  /** Optional breakdown ring rendered beside the metric — decoration on top
   * of the already-accessible BreakdownRow list in `children`, never the
   * only place the numbers live. */
  ring?: RingSegment[];
  children?: ReactNode;
  className?: string;
}) {
  const metricColor =
    tone === "danger"
      ? "text-rc-red"
      : tone === "warn"
        ? "text-rc-amber-deep"
        : tone === "ok"
          ? "text-rc-green-deep"
          : "text-rc-ink";

  const badgeColor =
    tone === "danger"
      ? "text-rc-red"
      : tone === "warn"
        ? "text-rc-amber-deep"
        : "text-rc-green-deep";

  const badgeGradient =
    tone === "danger" ? "var(--rc-badge-grad-red)" : tone === "warn" ? "var(--rc-badge-grad-amber)" : "var(--rc-badge-grad-green)";

  const ringHasValues = ring && ring.reduce((sum, s) => sum + s.value, 0) > 0;

  return (
    <div
      className={`group flex flex-col rounded-card border border-rc-border bg-white p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/70 ${badgeColor}`}
            style={{ background: badgeGradient }}
          >
            <Icon size={18} strokeWidth={2} />
          </span>
          <h3 className="text-sm font-semibold text-rc-ink">{title}</h3>
        </div>
        {href && (
          <Link href={href} className="shrink-0 text-xs font-medium text-rc-faint transition group-hover:text-rc-green-deep">
            {hrefLabel} →
          </Link>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        {metric !== undefined && (
          <div>
            <div className={`text-2xl font-bold tracking-tight ${metricColor}`}>{metric}</div>
            {caption && <div className="mt-0.5 text-xs text-rc-muted">{caption}</div>}
          </div>
        )}
        {ringHasValues && <DonutRing segments={ring!} size={52} strokeWidth={7} />}
      </div>

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
      <span className="flex items-center gap-1.5 text-rc-muted">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
        {label}
      </span>
      <span className="font-medium text-rc-ink">{count}</span>
    </div>
  );
}

export function StatTile({
  n,
  l,
  tone = "neutral",
  icon: Icon,
}: {
  n: number | string;
  l: string;
  tone?: "neutral" | "warn" | "ok";
  icon?: LucideIcon;
}) {
  const color = tone === "warn" ? "text-rc-amber-deep" : tone === "ok" ? "text-rc-green-deep" : "text-rc-ink";
  const badgeColor = tone === "warn" ? "text-rc-amber-deep" : tone === "ok" ? "text-rc-green-deep" : "text-rc-muted";
  const badgeGradient = tone === "warn" ? "var(--rc-badge-grad-amber)" : tone === "ok" ? "var(--rc-badge-grad-green)" : "var(--rc-green-soft)";
  return (
    <div className="group flex items-center gap-3 rounded-card border border-rc-border bg-white p-4 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
      {Icon && (
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-white/70 ${badgeColor}`}
          style={{ background: badgeGradient }}
        >
          <Icon size={17} strokeWidth={2} />
        </span>
      )}
      <div className="min-w-0">
        <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-rc-muted">{l}</div>
      </div>
    </div>
  );
}
