import { CalendarClock } from "lucide-react";
import { WidgetCard } from "./WidgetCard";

export function WeeklyReviewWidget({ dueCount }: { dueCount: number }) {
  return (
    <WidgetCard
      icon={CalendarClock}
      title="Weekly review"
      href="/dashboard/portfolio"
      hrefLabel="Office overview →"
      metric={dueCount}
      caption={dueCount === 0 ? "Every active file has had activity this week" : "files with no activity in 7+ days"}
      tone={dueCount > 0 ? "warn" : "ok"}
    />
  );
}
