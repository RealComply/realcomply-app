"use client";

import { useState, type ReactNode } from "react";

const TABS = [
  { key: "licence", label: "🪪 Licence register" },
  { key: "gifts", label: "🎁 Gift register" },
  { key: "complaints", label: "📮 Complaints register" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Keeps every panel mounted (display:none on the inactive ones) so switching
// tabs is instant and doesn't lose in-progress form state — the panels
// themselves are server-rendered content passed down as props, per the
// "server component renders, client component only switches" pattern.
export function RegistersTabs({
  licence,
  gifts,
  complaints,
  giftsBadge,
  complaintsBadge,
}: {
  licence: ReactNode;
  gifts: ReactNode;
  complaints: ReactNode;
  giftsBadge?: number;
  complaintsBadge?: number;
}) {
  const [active, setActive] = useState<TabKey>("licence");
  const badges: Partial<Record<TabKey, number>> = { gifts: giftsBadge, complaints: complaintsBadge };

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rc-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActive(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition ${
              active === tab.key
                ? "border-b-2 border-rc-green-deep text-rc-green-deep"
                : "border-b-2 border-transparent text-neutral-500 hover:text-rc-ink"
            }`}
          >
            {tab.label}
            {!!badges[tab.key] && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                {badges[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4" style={{ display: active === "licence" ? "block" : "none" }}>
        {licence}
      </div>
      <div className="mt-4" style={{ display: active === "gifts" ? "block" : "none" }}>
        {gifts}
      </div>
      <div className="mt-4" style={{ display: active === "complaints" ? "block" : "none" }}>
        {complaints}
      </div>
    </div>
  );
}
