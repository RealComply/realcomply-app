"use client";

import { useState, useTransition } from "react";
import { Globe, AlertTriangle, Check } from "lucide-react";
import { checkListingNow } from "@/lib/actions/website-scan";

// The advertised-price check, as shown on c1.
//
// NOTHING HERE IS SET-UP. There is no "link this listing" step and no page to
// confirm. Adam, 16 Aug 2026: a button the agent has to press "may as well just
// eyeball their own website. The whole point of this is for RealComply to
// routinely check the website and come back to the agent and let them know if
// their advertised price has slipped below the ESP." So the weekly run finds
// the page itself, and this panel is a read-out of what it found. Check now
// exists only for the impatient.
//
// It reports; the agent decides what to do about it. The one thing it does
// decide is whether to flag the item, and only where the page was confirmed to
// be this property and the arithmetic found a breach — because a finding nobody
// is told about is not a check.

export type ScanFinding = {
  checkedAt: string;
  url: string;
  ok: boolean;
  addressConfirmed: boolean;
  summary: string;
  issues: string[];
  priceShown: boolean;
  priceText?: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function ListingScanPanel({
  propertyId,
  finding,
}: {
  propertyId: string;
  finding?: ScanFinding;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await checkListingNow(propertyId);
      if (result.error) setError(result.error);
    });
  }

  const tone = !finding
    ? "none"
    : finding.issues.length > 0
      ? "warn"
      : finding.addressConfirmed
        ? "ok"
        : "unknown";

  return (
    <div className="mt-3 border-t border-rc-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-rc-muted">The live ad</p>

          {!finding ? (
            <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
              Your website is checked against this listing&rsquo;s ESP each week, once it&rsquo;s advertised. Nothing
              to set up.
            </p>
          ) : (
            <div className="mt-1">
              <p
                className={`flex items-start gap-1.5 text-sm leading-snug ${
                  tone === "warn" ? "text-rc-amber-deep" : tone === "ok" ? "text-rc-ink" : "text-rc-muted"
                }`}
              >
                {tone === "warn" ? (
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                ) : tone === "ok" ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-rc-green-deep" aria-hidden="true" />
                ) : (
                  <Globe size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                )}
                <span>{finding.summary}</span>
              </p>

              {finding.issues.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {finding.issues.map((issue, i) => (
                    <li key={i} className="text-[11px] leading-relaxed text-rc-amber-deep">
                      {issue}
                    </li>
                  ))}
                </ul>
              )}

              {/* Always show which page was read. The check finds the page
                  itself, so the agent's only way to catch it having read the
                  wrong one is to be told which one it was. */}
              <p className="mt-1.5 text-[11px] leading-relaxed text-rc-faint">
                Checked {when(finding.checkedAt)} ·{" "}
                <a
                  href={finding.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline hover:text-rc-muted"
                >
                  {finding.url}
                </a>
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-rc-faint">
                A read of your own listing page, not a compliance decision.
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={check}
          disabled={pending}
          className="shrink-0 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check now"}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-[11px] font-medium text-rc-amber-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
