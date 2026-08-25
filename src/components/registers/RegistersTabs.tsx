"use client";

import { useState, type ReactNode } from "react";
import { IdCard, ShieldCheck, Gift, Mail, TriangleAlert } from "lucide-react";

const TABS = [
  // "Licences & certificates", not "Licence register" — a certificate of
  // registration is a different credential from a licence, assistant agents
  // hold one and know the difference, and Adam went looking for "a
  // certificate register" without finding it here (18 Aug 2026). Same tab,
  // same records; the name now says what's in it.
  { key: "licence", label: "Licences & certificates", icon: IdCard },
  { key: "insurance", label: "Insurance register", icon: ShieldCheck },
  { key: "gifts", label: "Gift register", icon: Gift },
  { key: "complaints", label: "Complaints register", icon: Mail },
  { key: "breaches", label: "Breach register", icon: TriangleAlert },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Trust account had a tab here from 25 Aug 2026 until later the same day, when
// it moved to its own page and nav entry — several named accounts, a monthly
// cadence and real penalties made it too big to sit sixth in a tab strip.
// See app/dashboard/trust/page.tsx.

// A tab's badge carries a severity, not just a number.
//
// Every badge on this strip used to render in red-100/red-700 whatever it was
// counting, so an open complaint looked exactly as urgent as an expired
// licence. Adam, 25 Aug 2026, asked for the sidebar's orange and red dots
// "on anything outstanding in the licensee section" — and the honest version of
// that is one rule applied everywhere: amber means someone needs to look at
// this, red means something has actually lapsed or is wrong.
//
// A dot rather than a number, matching the Listings row in the sidebar. The
// count is still announced to screen readers and sits in the tab's title, so
// nothing is lost — it just stops competing with the label for attention when
// five tabs all have something to say.
export type TabBadge = { count: number; tone: "amber" | "red" };

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
  licenceBadge,
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
  licenceBadge?: TabBadge;
  insuranceBadge?: TabBadge;
  giftsBadge?: TabBadge;
  complaintsBadge?: TabBadge;
  breachesBadge?: TabBadge;
  // Lets a link elsewhere in the app (e.g. the Home page's Gifts widget,
  // or an agent's own nav shortcut) land directly on a specific tab
  // instead of always opening on Licence register — see ?tab= on
  // /dashboard/registers.
  defaultTab?: TabKey;
}) {
  const [active, setActive] = useState<TabKey>(defaultTab);
  const badges: Partial<Record<TabKey, TabBadge | undefined>> = {
    licence: licenceBadge,
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
              title={
                badges[tab.key]?.count
                  ? `${tab.label} — ${badges[tab.key]!.count} needing attention`
                  : tab.label
              }
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition ${
                active === tab.key
                  ? "border-b-2 border-rc-green-deep text-rc-green-deep"
                  : "border-b-2 border-transparent text-rc-muted hover:text-rc-ink"
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {tab.label}
              {!!badges[tab.key]?.count && (
                <>
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      badges[tab.key]!.tone === "red" ? "bg-rc-red" : "bg-rc-amber"
                    }`}
                  />
                  <span className="sr-only">
                    {badges[tab.key]!.count} needing attention
                  </span>
                </>
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
