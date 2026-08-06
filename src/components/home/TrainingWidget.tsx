import { WidgetCard } from "./WidgetCard";

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
      icon="🧑‍🏫"
      title="Training"
      href="/dashboard/training"
      hrefLabel="Training log →"
      metric={sessionsLast90Days}
      caption={`sessions in the last 90 days · ${totalSessions} on file${
        lastSessionDate ? ` · last ${new Date(lastSessionDate).toLocaleDateString("en-AU")}` : ""
      }`}
      tone={sessionsLast90Days === 0 ? "warn" : "ok"}
    />
  );
}
