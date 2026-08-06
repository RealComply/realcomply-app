import { MessageSquareWarning } from "lucide-react";
import { WidgetCard, BreakdownRow } from "./WidgetCard";

export function ComplaintsWidget({
  open,
  underReview,
  overdue,
  resolved,
}: {
  open: number;
  underReview: number;
  overdue: number;
  resolved: number;
}) {
  return (
    <WidgetCard
      icon={MessageSquareWarning}
      title="Complaints"
      href="/dashboard/registers"
      hrefLabel="Registers →"
      metric={open + underReview}
      caption="currently open"
      tone={overdue > 0 ? "danger" : open + underReview > 0 ? "warn" : "ok"}
      ring={[
        { value: resolved, colorVar: "var(--rc-green-deep)" },
        { value: Math.max(open + underReview - overdue, 0), colorVar: "var(--rc-amber)" },
        { value: overdue, colorVar: "var(--rc-red)" },
      ]}
    >
      <BreakdownRow dot="red" label="Overdue against target" count={overdue} />
      <BreakdownRow dot="amber" label="Open / under review" count={open + underReview} />
      <BreakdownRow dot="green" label="Resolved" count={resolved} />
    </WidgetCard>
  );
}
