"use client";

import { useState } from "react";
import { MY_LISTINGS_PAGE_HELP } from "@/lib/listings-pages";

// "Your listings page" at sign-up and when an invited agent accepts their
// invite (Adam, 2 Nov 2026; 0105). Optional, with Skip; it never blocks
// sign-up (lib/auth/signup-listings-page.ts). Skipped, nothing is sent and
// the office page is used; it can be added later in Profile settings.
export function ListingsPageSignupField({ defaultValue }: { defaultValue?: string }) {
  const [skipped, setSkipped] = useState(false);
  if (skipped) {
    return (
      <p className="text-xs leading-relaxed text-rc-muted">
        Skipped. You can add your own listings page later in Profile settings.{" "}
        <button type="button" className="font-semibold text-rc-green-deep underline" onClick={() => setSkipped(false)}>
          Add it now
        </button>
      </p>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor="listingsPage" className="block text-sm font-medium text-rc-ink">
          Your listings page <span className="font-normal text-rc-faint">(optional)</span>
        </label>
        <button type="button" className="text-xs font-semibold text-rc-green-deep underline" onClick={() => setSkipped(true)}>
          Skip
        </button>
      </div>
      <input
        id="listingsPage"
        name="listingsPage"
        // Plain text, not type="url", as the office page field: people type
        // "youroffice.com.au/agents/jo" and the server makes it an address.
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={defaultValue}
        placeholder="youroffice.com.au/agents/your-name"
        className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">{MY_LISTINGS_PAGE_HELP}</p>
    </div>
  );
}
