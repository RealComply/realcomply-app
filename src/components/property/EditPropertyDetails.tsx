"use client";

import { useActionState, useState } from "react";
import { Settings2 } from "lucide-react";
import { updatePropertyDetails } from "@/lib/actions/properties";
import type { Property, PropertyType } from "@/lib/types";
import { SaleMethodFields } from "@/components/property/SaleMethodFields";

// Edit the setup answers on an existing listing.
//
// Collapsed by default, and sitting below the items rather than above them.
// These are answers you set once and revisit rarely; given permanent space at
// the top of the page they would compete with the compliance work, which is
// what the page is actually for.

const initial = { error: null as string | null };

function YesNo({ name, label, value }: { name: string; label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-rc-ink">{label}</span>
      <div className="flex shrink-0 gap-3">
        {["yes", "no"].map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-sm text-rc-muted">
            <input
              type="radio"
              name={name}
              value={v}
              defaultChecked={value === (v === "yes")}
              className="accent-rc-green-deep"
            />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
    </div>
  );
}

export function EditPropertyDetails({ property }: { property: Property }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const action = updatePropertyDetails.bind(null, property.id);
  const [state, formAction, pending] = useActionState(
    async (prev: typeof initial, fd: FormData) => {
      const result = await action(prev, fd);
      if (!result.error) setSaved(true);
      return result;
    },
    initial,
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-rc-muted transition hover:text-rc-ink"
      >
        <Settings2 size={14} aria-hidden="true" />
        Edit listing details
      </button>
    );
  }

  return (
    <form action={formAction} className="mt-8 rounded-card border border-rc-border bg-white p-5 shadow-card">
      <h2 className="text-sm font-semibold text-rc-ink">Listing details</h2>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">
        Changing an answer here changes which items appear on this file. Nothing already recorded is deleted —
        an item that disappears keeps whatever you put in it, and comes back if you change the answer again.
      </p>

      <label htmlFor="address" className="mt-4 block text-xs font-medium text-rc-muted">
        Address
      </label>
      <input
        id="address"
        name="address"
        defaultValue={property.address}
        required
        className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />

      <label htmlFor="propertyType" className="mt-3 block text-xs font-medium text-rc-muted">
        Property type
      </label>
      <select
        id="propertyType"
        name="propertyType"
        defaultValue={property.property_type ?? "House"}
        className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      >
        {/* Exactly the values in PropertyType (src/lib/types.ts). Typed as a
            plain string on the way through the form, so an option that is not
            in that union would be written to the row without TypeScript
            noticing — this list has to be kept in step by hand. */}
        {(["House", "Unit", "Townhouse", "Duplex", "Land"] satisfies PropertyType[]).map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* The page the weekly advertised-price check reads. Optional: a listing
          that is not advertised anywhere yet has no page to check, and the
          check simply skips it. */}
      <label htmlFor="listingUrl" className="mt-3 block text-xs font-medium text-rc-muted">
        Listing page address <span className="font-normal text-rc-faint">(optional)</span>
      </label>
      <input
        id="listingUrl"
        name="listingUrl"
        // Plain text rather than type="url" — the browser rejects a pasted
        // address without a scheme and its message can't be reworded. The
        // value is normalised server-side (lib/normalise-url.ts).
        type="text"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={property.listing_url ?? ""}
        placeholder="youragency.com.au/listing/..."
        className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
        Your own listing page for this property. Checked weekly against the ESP on file.
      </p>

      <div className="mt-4">
        <SaleMethodFields
          defaultMethod={property.sale_method}
          defaultDate={property.auction_date}
          defaultTime={property.auction_time}
          defaultVenue={property.auction_venue}
          compact
        />
      </div>

      <div className="mt-3 divide-y divide-rc-border border-y border-rc-border">
        <YesNo name="isStrata" label="Strata or community title" value={Boolean(property.is_strata)} />
        <YesNo name="isTenanted" label="Currently tenanted" value={Boolean(property.is_tenanted)} />
        <YesNo name="hasPool" label="Has a pool" value={Boolean(property.has_pool)} />
        <YesNo
          name="agentInterest"
          label="You or a related party have an interest in it"
          value={Boolean(property.agent_interest)}
        />
      </div>

      {/* Test mode. Named for what it does rather than what the column is
          called — "test_mode" means nothing to an agent, whereas the reason
          they want it is that the later stages are otherwise unreachable. */}
      <div className="mt-3 rounded-md border border-rc-border bg-rc-bg-alt px-3 py-2.5">
        <YesNo name="testMode" label="Practice listing — unlock all stages" value={Boolean(property.test_mode)} />
        <p className="text-[11px] leading-relaxed text-rc-muted">
          Lets you open any stage on this file without completing the ones before it, so you can try things out.
          Use it on a scratch listing, not a real one.
        </p>
      </div>

      {state.error && (
        <p className="mt-3 text-sm font-medium text-rc-amber-deep" role="alert">
          {state.error}
        </p>
      )}
      {saved && !state.error && !pending && (
        <p className="mt-3 text-sm font-medium text-rc-green-deep">Saved.</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save details"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full border border-rc-border bg-white px-4 py-1.5 text-xs font-medium text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink"
        >
          Close
        </button>
      </div>
    </form>
  );
}
