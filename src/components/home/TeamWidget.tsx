import { Users } from "lucide-react";
import { WidgetCard } from "./WidgetCard";

export function TeamWidget({ staffCount, pendingInvites }: { staffCount: number; pendingInvites: number }) {
  return (
    <WidgetCard
      icon={Users}
      title="Team"
      href="/dashboard/team"
      hrefLabel="Team"
      metric={staffCount}
      caption={`${staffCount === 1 ? "person" : "people"} in the office${pendingInvites > 0 ? ` · ${pendingInvites} invite${pendingInvites === 1 ? "" : "s"} pending` : ""}`}
      tone={pendingInvites > 0 ? "warn" : "neutral"}
    />
  );
}
