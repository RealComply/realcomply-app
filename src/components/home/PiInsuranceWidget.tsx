import { WidgetCard } from "./WidgetCard";
import { EXPIRY_STATUS_LABELS, type ExpiryStatus } from "@/lib/expiry-status";

export function PiInsuranceWidget({
  status,
  expiry,
  insurer,
}: {
  status: ExpiryStatus;
  expiry: string | null;
  insurer: string | null;
}) {
  const tone = status === "expired" ? "danger" : status === "urgent" || status === "soon" ? "warn" : status === "ok" ? "ok" : "neutral";
  return (
    <WidgetCard
      icon="🛡️"
      title="PI insurance"
      href="/dashboard/registers"
      hrefLabel="Registers →"
      metric={EXPIRY_STATUS_LABELS[status]}
      caption={
        expiry
          ? `${insurer ?? "Insurer not on file"} · expires ${new Date(expiry).toLocaleDateString("en-AU")}`
          : "No policy details on file"
      }
      tone={tone}
    />
  );
}
