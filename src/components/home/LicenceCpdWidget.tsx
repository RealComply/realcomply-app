import { WidgetCard, BreakdownRow } from "./WidgetCard";

export function LicenceCpdWidget({
  holders,
  current,
  expiringSoon,
  expired,
  cpdOutstanding,
  cpdYearLabel,
}: {
  holders: number;
  current: number;
  expiringSoon: number;
  expired: number;
  cpdOutstanding: number;
  cpdYearLabel: string;
}) {
  return (
    <WidgetCard
      icon="🎓"
      title="Licence & CPD"
      href="/dashboard/registers"
      hrefLabel="Registers →"
      metric={holders}
      caption={`licence holders · ${cpdYearLabel} CPD year`}
      tone={expired > 0 ? "danger" : expiringSoon > 0 || cpdOutstanding > 0 ? "warn" : "ok"}
    >
      <BreakdownRow dot="green" label="Current" count={current} />
      <BreakdownRow dot="amber" label="Expiring ≤ 30 days" count={expiringSoon} />
      <BreakdownRow dot="red" label="Expired" count={expired} />
      <BreakdownRow dot="neutral" label="CPD outstanding this year" count={cpdOutstanding} />
    </WidgetCard>
  );
}
