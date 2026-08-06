// Shared traffic-light logic for anything with an expiry date (licences, PI
// insurance) — the 90/30/7-day reminder cadence referenced in the
// competitive-landscape doc as the category standard. Pure date math so it
// can run in a server component without a "use client" boundary.
export type ExpiryStatus = "none" | "expired" | "urgent" | "soon" | "ok";

export function expiryStatus(dateStr: string | null, today: Date = new Date()): ExpiryStatus {
  if (!dateStr) return "none";
  const expiry = new Date(`${dateStr}T00:00:00Z`);
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const days = Math.round((expiry.getTime() - todayUtc.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "expired";
  if (days <= 30) return "urgent";
  if (days <= 90) return "soon";
  return "ok";
}

export const EXPIRY_STATUS_STYLES: Record<ExpiryStatus, string> = {
  none: "bg-neutral-100 text-neutral-500",
  expired: "bg-red-100 text-red-700",
  urgent: "bg-rc-amber/20 text-rc-amber-deep",
  soon: "bg-rc-amber/10 text-rc-amber-deep",
  ok: "bg-rc-green/10 text-rc-green-deep",
};

export const EXPIRY_STATUS_LABELS: Record<ExpiryStatus, string> = {
  none: "Not on file",
  expired: "Expired",
  urgent: "Expires soon",
  soon: "Renew soon",
  ok: "Current",
};
