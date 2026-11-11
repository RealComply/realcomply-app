import { BookOpen } from "lucide-react";
import { WidgetCard } from "./WidgetCard";
import { formatAuShortDate } from "@/lib/format-date";

export function SgManualWidget({
  hasVersion,
  versionLabel,
  uploadedAt,
}: {
  hasVersion: boolean;
  versionLabel: string | null;
  uploadedAt: string | null;
}) {
  return (
    <WidgetCard
      icon={BookOpen}
      title="Supervision Guidelines"
      href="/dashboard/sg-manual"
      hrefLabel="Supervision guidelines"
      metric={hasVersion ? "On file" : "Not uploaded"}
      caption={
        hasVersion
          ? `${versionLabel ?? "Current version"}${uploadedAt ? ` · ${formatAuShortDate(uploadedAt)}` : ""}`
          : "Upload your manual to keep it on file"
      }
      tone={hasVersion ? "ok" : "warn"}
    />
  );
}
