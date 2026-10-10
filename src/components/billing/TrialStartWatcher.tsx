"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Back from Stripe's checkout before Stripe's webhook has landed (10 Oct
// 2026). Stripe sends the person to /dashboard/billing?started=1, but until
// the webhook records the subscription the dashboard layout still shows the
// start-your-trial page, plan picker and all. The page said it "updates
// within a minute" and nothing refreshed it, and pressing a plan again
// started a second checkout: two trials, then two charges.
//
// So, only on the way back from checkout: say it has gone through, keep the
// plan picker out of reach, and ask the server again every few seconds until
// the layout lets them in. If Stripe still has not confirmed after two
// minutes, the picker comes back with a warning rather than leaving them
// stuck.

const EVERY_MS = 5_000;
const FOR_MS = 120_000;

export function TrialStartWatcher({ children }: { children: ReactNode }) {
  const router = useRouter();
  const started = useSearchParams().get("started") === "1";
  const [waiting, setWaiting] = useState(started);

  useEffect(() => {
    if (!started) return;
    const tick = window.setInterval(() => router.refresh(), EVERY_MS);
    const stop = window.setTimeout(() => {
      window.clearInterval(tick);
      setWaiting(false);
    }, FOR_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(stop);
    };
  }, [started, router]);

  if (!started) return <>{children}</>;

  if (waiting) {
    return (
      <p
        role="status"
        className="mt-6 rounded-xl border border-rc-green-deep/25 bg-rc-green-soft px-4 py-3 text-sm font-semibold text-rc-green-deep"
      >
        Thanks — that&rsquo;s gone through. We&rsquo;re waiting for Stripe to confirm it, and this page opens
        RealComply by itself, usually within a minute.
      </p>
    );
  }

  return (
    <>
      <p role="status" className="mt-6 rounded-xl border border-rc-amber/40 bg-rc-amber/10 px-4 py-3 text-sm text-rc-ink">
        Stripe hasn&rsquo;t confirmed it yet. Reload this page in a minute before choosing a plan again, so a second
        subscription isn&rsquo;t started. Still stuck? Email admin@realcomply.com.au.
      </p>
      {children}
    </>
  );
}
