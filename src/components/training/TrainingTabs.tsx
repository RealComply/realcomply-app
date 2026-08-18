"use client";

import { useState, type ReactNode } from "react";
import { ClipboardCheck, History } from "lucide-react";

// Training log and training plans, one section, two tabs.
//
// Adam, 18 Aug 2026: "training plans and training logs should be in the same
// section, not separated out." He's right — they're two views of one thing.
// The plan says what a person will do this CPD year; the log says what
// actually happened. Splitting them across two nav entries made the app look
// like it had two unrelated training features, and made the relationship
// between them something you had to already understand.
//
// Same keep-everything-mounted pattern as RegistersTabs: the panels are
// server-rendered content passed down as props, so switching is instant and
// nothing in an open form is lost.

const TABS = [
  { key: "plans", label: "Training plans", icon: ClipboardCheck },
  { key: "log", label: "Training log", icon: History },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function TrainingTabs({
  plans,
  log,
  defaultTab = "plans",
  plansBadge,
}: {
  plans: ReactNode;
  log: ReactNode;
  // Plans leads, because it's the thing Requirement 2.4 actually asks for.
  // The log is evidence that accumulates against it.
  defaultTab?: TabKey;
  plansBadge?: number;
}) {
  const [active, setActive] = useState<TabKey>(defaultTab);

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-rc-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const badge = tab.key === "plans" ? plansBadge : undefined;
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
              {!!badge && (
                <span className="rounded-full bg-rc-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-rc-amber-deep">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-5" style={{ display: active === "plans" ? "block" : "none" }}>
        {plans}
      </div>
      <div className="mt-5" style={{ display: active === "log" ? "block" : "none" }}>
        {log}
      </div>
    </div>
  );
}
