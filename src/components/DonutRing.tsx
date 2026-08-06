// A small SVG ring chart used to give the Home-dashboard widgets that have a
// real breakdown (licence status, complaint status, gift status) some visual
// weight beyond a number and three text rows — the "depth" PropertyMe/LockedOn
// get from their donut/progress rings. Deliberately supplementary, not the
// sole carrier of the data: every widget that renders one also renders the
// same counts as text via BreakdownRow immediately below it, so this is
// decoration on top of an already-accessible breakdown, not a chart someone
// has to squint at to read a number off.
//
// Pure SVG (stroke-dasharray per segment), no client JS/charting library —
// renders fine in a server component.
export type RingSegment = { value: number; colorVar: string };

export function DonutRing({
  segments,
  size = 56,
  strokeWidth = 8,
  centerLabel,
}: {
  segments: RingSegment[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string | number;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let offset = 0;
  const arcs =
    total > 0
      ? segments
          .filter((s) => s.value > 0)
          .map((s, i) => {
            const fraction = s.value / total;
            // 2px surface gap between adjacent segments (dataviz mark spec),
            // capped so it never eats a whole sliver segment.
            const gap = Math.min(2, fraction * circumference * 0.15);
            const length = Math.max(fraction * circumference - gap, 0);
            const dasharray = `${length} ${circumference - length}`;
            const dashoffset = -offset;
            offset += fraction * circumference;
            return <circle key={i} r={radius} cx={center} cy={center} fill="none" stroke={s.colorVar} strokeWidth={strokeWidth} strokeDasharray={dasharray} strokeDashoffset={dashoffset} strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`} />;
          })
      : null;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle r={radius} cx={center} cy={center} fill="none" stroke="var(--rc-border)" strokeWidth={strokeWidth} />
        {arcs}
      </svg>
      {centerLabel !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-rc-ink">{centerLabel}</div>
      )}
    </div>
  );
}
