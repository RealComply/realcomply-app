import { Presentation } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { formatAuShortDate } from "@/lib/format-date";

export function TrainingWidget({
  sessionsLast90Days,
  totalSessions,
  lastSessionDate,
}: {
  sessionsLast90Days: number;
  totalSessions: number;
  lastSessionDate: string | null;
}) {
  return (
    <WidgetCard
      icon={Presentation}
      title="Training"
      href="/dashboard/training"
      hrefLabel="Training log"
      metric={sessionsLast90Days}
      caption={`sessions in the last 90 days · ${totalSessions} on file${
        lastSessionDate ? ` · last ${formatAuShortDate(lastSessionDate)}` : ""
      }`}
      tone={sessionsLast90Days === 0 ? "warn" : "ok"}
    />
  );
}
