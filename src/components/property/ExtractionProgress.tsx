"use client";

import { useEffect, useState } from "react";

// What the agent looks at while their three documents are read.
//
// Adam, 8 Sep 2026: "we should have a little box display telling the user that
// the documents are being read and have an approximate time bar showing the
// progress so they can see what's going on."
//
// THE BAR IS AN ESTIMATE AND SAYS SO. There is no real progress to report: the
// read is one awaited server call, and nothing comes back until all three
// documents are done. So this measures elapsed time against a typical run
// rather than pretending to know how far through it is.
//
// Which means the one thing it must never do is finish. A bar that fills to
// 100% and then sits there is worse than no bar at all — it tells the person
// the work is done and the app is stuck, and the next thing they do is close
// the tab and lose the redirect. So it eases toward 92% and stops, and if the
// read overruns the estimate the WORDS change rather than the bar, because the
// words can be honest about not knowing and a bar cannot.
//
// For the same reason there are no ticks against individual documents. They
// are read in a fixed order, so a timer could show "reading the contract" and
// be right most of the time — and wrong on exactly the slow file where someone
// is actually reading the screen.

/** Where the bar stops. Never 100 — see above. */
const CEILING = 92;

/** How long a typical three-document read takes. Not a promise. */
const TYPICAL_MS = 70_000;

const DOCUMENTS = ["Agency agreement", "Contract for sale", "Comparable sales report"];

export function ExtractionProgress() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(id);
  }, []);

  // Fast at first, slower as it approaches the ceiling. A linear bar that
  // reaches the end at exactly the expected moment is wrong more often than it
  // is right; this one is always moving and never arrives.
  const fraction = 1 - Math.exp(-elapsed / (TYPICAL_MS / 2.2));
  const percent = Math.min(CEILING, Math.round(fraction * CEILING));
  const overrunning = elapsed > TYPICAL_MS * 1.4;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-rc-ink/40 px-4 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-card border border-rc-border bg-white p-6 shadow-card">
        <p className="text-base font-bold tracking-tight text-rc-ink">Reading your documents</p>
        <p className="mt-1 text-sm leading-relaxed text-rc-muted">
          Your listing has been created. We&rsquo;re reading the three documents now so the file is already
          filled in when you get there.
        </p>

        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-rc-bg-alt">
          <div
            className="h-full rounded-full bg-rc-green-deep transition-[width] duration-300 ease-out"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
        </div>

        <p className="mt-2 text-xs font-medium text-rc-muted">
          {overrunning
            ? "Taking a bit longer than usual — still going."
            : "This usually takes about a minute."}
        </p>

        <ul className="mt-4 space-y-1 border-t border-rc-border pt-3">
          {DOCUMENTS.map((d) => (
            <li key={d} className="text-xs text-rc-faint">
              {d}
            </li>
          ))}
        </ul>

        {/* The one instruction that matters. The read continues either way, but
            closing the tab loses the redirect, and the agent then has to find
            the listing themselves and wonder whether it worked. */}
        <p className="mt-3 text-xs leading-relaxed text-rc-faint">
          Keep this page open. If anything can&rsquo;t be read you&rsquo;ll still get your file, with those
          cards left for you to fill in.
        </p>
      </div>
    </div>
  );
}
