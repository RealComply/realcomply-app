"use client";

import { useState, type ReactNode } from "react";
import { IdCard, ShieldCheck, Gift, Mail, TriangleAlert } from "lucide-react";

const TABS = [
  { key: "licence", label: "Licence register", icon: IdCard },
  { key: "insurance", label: "Insurance register", icon: ShieldCheck },
  { key: "gifts", label: "Gift register", icon: Gift },
  { key: "complaints", label: "Complaints register", icon: Mail },
  { key: "breaches", label: "Breach register", icon: TriangleAlert },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Keeps every panel mounted (display:none on the inactive ones) so switching
// tabs is instant and doesn't lose in-progress form state — the panels
// themselves are server-rendered content passed down as props, per the
// "server component renders, client component only switches" pattern.
export function RegistersTabs({
  licence,
  insurance,
  gifts,
  complaints,
  breaches,
  insuranceBadge,
  giftsBadge,
  complaintsBadge,
  breachesBadge,
  defaultTab = "licence",
}: {
  licence: ReactNode;
  insurance: ReactNode;
  gifts: ReactNode;
  complaints: ReactNode;
  breaches: ReactNode;
  insuranceBadge?: number;
  giftsBadge?: number;
  complaintsBadge?: number;
  breachesBadge?: number;
  // Lets a link elsewhere in the app (e.g. the Home page's Gifts widget,
  // or an agent's own nav shortcut) land directly on a specific tab
  // instead of always opening on Licence register — see ?tab= on
  // /dashboard/registers.
  defaultTab?: TabKey;
}) {
  const [active, setActive] = useState<TabKey>(defaultTab);
  const badges: Partial<Record<TabKey, number>> = {
    insurance: insuranceBadge,
    gifts: giftsBadge,
    complaints: complaintsBadge,
    breaches: breachesBadge,
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rc-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition ${
                active === tab.key
                  ? "border-b-2 border-rc-green-deep text-rc-green-deep"
                  : "border-b-2 border-transparent text-rc-muted hover:text-rc-ink"
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {tab.label}
              {!!badges[tab.key] && (
                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                  {badges[tab.key]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4" style={{ display: active === "licence" ? "block" : "none" }}>
        {licence}
      </div>
      <div className="mt-4" style={{ display: active === "insurance" ? "block" : "none" }}>
        {insurance}
      </div>
      <div className="mt-4" style={{ display: active === "gifts" ? "block" : "none" }}>
        {gifts}
      </div>
      <div className="mt-4" style={{ display: active === "complaints" ? "block" : "none" }}>
        {complaints}
      </div>
      <div className="mt-4" style={{ display: active === "breaches" ? "block" : "none" }}>
        {breaches}
      </div>
    </div>
  );
}
