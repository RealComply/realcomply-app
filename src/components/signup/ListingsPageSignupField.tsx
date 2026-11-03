"use client";

import { useState } from "react";
import {
  ADD_AGENCY_PAGE,
  MY_LISTINGS_PAGE_HELP,
  OFFICE_PAGE_SIGNUP_HELP,
  OWN_PLAN_PAGE_HELP,
} from "@/lib/listings-pages";

// The listings page at sign-up (Adam, 3 Nov 2026; approved mockup "Agent
// Listings Pages"). One optional field on each sign-up form, and leaving it
// blank never blocks sign-up (lib/actions/auth.ts):
//
//   * an office signing up: "Your office's listings page" (agencies.website_url)
//   * an agent on their own plan: "Your listings page" (their own page), and
//     "+ Add your agency's listings page too" opens a second field for the
//     agency's page
//   * an agent invited by their office: "Your listings page", with Skip, as
//     built on 2 Nov 2026
//
// Which form is which: the plan is picked after sign-up, so the sign-up form
// goes by the answer to "Are you the licensee in charge?". "Yes, that's me"
// sets up an office; "No, someone else" is an agent with their own account
// whose licensee is someone else.
//
// Both values are held here, so switching that answer keeps what was typed.

export type ListingsPageVariant = "office" | "own_plan" | "invited";

const INPUT =
  "mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";

function AddressInput({
  id,
  name,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      id={id}
      name={name}
      // Plain text, not type="url": people type "youroffice.com.au/agents/jo"
      // and the server makes it an address (lib/normalise-url.ts).
      type="text"
      inputMode="url"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={INPUT}
    />
  );
}

function Optional() {
  return <span className="font-normal text-rc-faint">(optional)</span>;
}

export function ListingsPageSignupField({
  variant,
  defaultListingsPage,
  defaultAgencyPage,
}: {
  variant: ListingsPageVariant;
  defaultListingsPage?: string;
  defaultAgencyPage?: string;
}) {
  const [ownPage, setOwnPage] = useState(defaultListingsPage ?? "");
  const [agencyPage, setAgencyPage] = useState(defaultAgencyPage ?? "");
  const [showAgency, setShowAgency] = useState(Boolean(defaultAgencyPage));
  const [skipped, setSkipped] = useState(false);

  if (variant === "office") {
    return (
      <div>
        <label htmlFor="websiteUrl" className="block text-sm font-medium text-rc-ink">
          Your office&rsquo;s listings page <Optional />
        </label>
        <AddressInput
          id="websiteUrl"
          name="websiteUrl"
          value={agencyPage}
          onChange={setAgencyPage}
          placeholder="youroffice.com.au/for-sale"
        />
        <p className="mt-1 text-xs leading-relaxed text-rc-muted">{OFFICE_PAGE_SIGNUP_HELP}</p>
      </div>
    );
  }

  if (variant === "own_plan") {
    return (
      <div>
        <label htmlFor="listingsPage" className="block text-sm font-medium text-rc-ink">
          Your listings page <Optional />
        </label>
        <p className="mt-1 text-xs leading-relaxed text-rc-muted">{OWN_PLAN_PAGE_HELP}</p>
        <AddressInput
          id="listingsPage"
          name="listingsPage"
          value={ownPage}
          onChange={setOwnPage}
          placeholder="youragency.com.au/agents/your-name"
        />
        {showAgency ? (
          <div className="mt-3">
            <label htmlFor="websiteUrl" className="block text-sm font-medium text-rc-ink">
              Your agency&rsquo;s listings page <Optional />
            </label>
            <AddressInput
              id="websiteUrl"
              name="websiteUrl"
              value={agencyPage}
              onChange={setAgencyPage}
              placeholder="youragency.com.au/for-sale"
            />
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">
              The page that shows all your agency&rsquo;s properties for sale. RealComply checks it after your own page.
            </p>
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 text-xs font-semibold text-rc-green-deep underline"
            onClick={() => setShowAgency(true)}
          >
            {ADD_AGENCY_PAGE}
          </button>
        )}
      </div>
    );
  }

  // Invited by their office (2 Nov 2026), unchanged: optional, with Skip.
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
          Your listings page <Optional />
        </label>
        <button type="button" className="text-xs font-semibold text-rc-green-deep underline" onClick={() => setSkipped(true)}>
          Skip
        </button>
      </div>
      <AddressInput
        id="listingsPage"
        name="listingsPage"
        value={ownPage}
        onChange={setOwnPage}
        placeholder="youroffice.com.au/agents/your-name"
      />
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">{MY_LISTINGS_PAGE_HELP}</p>
    </div>
  );
}
