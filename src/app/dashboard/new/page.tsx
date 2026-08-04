"use client";

import { useActionState } from "react";
import { createProperty } from "@/lib/actions/properties";
import type { ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

function YesNo({ name, label, help }: { name: string; label: string; help?: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-rc-ink">{label}</legend>
      {help && <p className="mt-0.5 text-xs text-neutral-500">{help}</p>}
      <div className="mt-2 flex gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} value="yes" className="accent-rc-green-deep" />
          Yes
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={name}
            value="no"
            defaultChecked
            className="accent-rc-green-deep"
          />
          No
        </label>
      </div>
    </fieldset>
  );
}

function DocUpload({ name, label, itemLabel }: { name: string; label: string; itemLabel: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-rc-ink">
        {label} <span className="font-normal text-neutral-400">(optional)</span>
      </label>
      <p className="mt-0.5 text-xs text-neutral-500">
        Attaches straight to &ldquo;{itemLabel}&rdquo; so it&rsquo;s waiting there when you reach it — you can
        always add or replace it later on the item itself.
      </p>
      <input
        id={name}
        name={name}
        type="file"
        className="mt-1.5 w-full text-xs text-neutral-500 file:mr-2 file:rounded-md file:border file:border-rc-border file:bg-white file:px-2 file:py-1.5 file:text-xs file:font-medium"
      />
    </div>
  );
}

export default function NewPropertyPage() {
  const [state, formAction, pending] = useActionState(createProperty, initialState);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
      <h1 className="text-xl font-semibold text-rc-ink">Add a property</h1>
      <p className="mt-1 text-sm text-neutral-500">
        These answers unlock the right checklist items for this listing — e.g. the
        tenancy notice items, or the strata pool-certificate exemption.
      </p>

      <form action={formAction} className="mt-8 space-y-6">
        {state.error && (
          <p className="rounded-md border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
            {state.error}
          </p>
        )}

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-rc-ink">
            Property address
          </label>
          <input
            id="address"
            name="address"
            type="text"
            required
            placeholder="6/2C Amor Street, Asquith NSW 2077"
            className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="propertyType" className="block text-sm font-medium text-rc-ink">
            Property type
          </label>
          <select
            id="propertyType"
            name="propertyType"
            defaultValue="House"
            className="mt-1 w-full rounded-md border border-rc-border px-3 py-2 text-sm focus:border-rc-green-deep focus:outline-none"
          >
            <option value="House">House</option>
            <option value="Unit">Unit</option>
            <option value="Townhouse">Townhouse</option>
            <option value="Duplex">Duplex</option>
            <option value="Land">Land</option>
          </select>
        </div>

        <YesNo
          name="isStrata"
          label="Is this a strata scheme?"
          help="Strata schemes of more than two lots don't need a separate pool compliance certificate — strata handles it."
        />
        <YesNo name="isTenanted" label="Is the property currently tenanted?" />
        <YesNo name="hasPool" label="Does the property have a pool?" />

        <div className="border-t border-rc-border pt-6">
          <h2 className="text-sm font-semibold text-rc-ink">Documents you already have</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Attach these now if you have them and skip re-uploading later. Each one files against the right
            item as evidence — then use &ldquo;Extract from uploaded documents&rdquo; on the property page to
            have the AI pre-fill what it can find (you&rsquo;ll still review and confirm every field before
            saving).
          </p>
          <div className="mt-4 space-y-4">
            <DocUpload
              name="agencyAgreementFile"
              label="Agency agreement"
              itemLabel="Agency agreement signed; copy served within 48 hours"
            />
            <DocUpload
              name="contractFile"
              label="Contract for sale"
              itemLabel="Contract of sale prepared with prescribed documents"
            />
            <DocUpload
              name="comparableSalesFile"
              label="Comparable sales report"
              itemLabel="Comparable-sales evidence held"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create property"}
        </button>
      </form>
    </main>
  );
}
