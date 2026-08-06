import { BookOpen } from "lucide-react";
import { WidgetCard } from "./WidgetCard";

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
      hrefLabel="SG Manual →"
      metric={hasVersion ? "On file" : "Not uploaded"}
      caption={
        hasVersion
          ? `${versionLabel ?? "Current version"}${uploadedAt ? ` · ${new Date(uploadedAt).toLocaleDateString("en-AU")}` : ""}`
          : "Upload your manual to keep it on file"
      }
      tone={hasVersion ? "ok" : "warn"}
    />
  );
}
