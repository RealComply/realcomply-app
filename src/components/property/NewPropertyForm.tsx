"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { createProperty } from "@/lib/actions/properties";
import { searchAddress, type AddressSuggestion } from "@/lib/actions/places";
import type { ActionState } from "@/lib/actions/auth";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { buildStagingPath, uploadEvidenceObject } from "@/lib/storage/evidence";

const initialState: ActionState = { error: null };

// Kept in sync with SETUP_EVIDENCE_FIELDS in src/lib/actions/properties.ts —
// which item each upload field files evidence against.
const DOC_FIELDS: Array<{ field: string; itemKey: string; label: string }> = [
  { field: "agencyAgreementFile", itemKey: "a3", label: "Agency agreement" },
  { field: "contractFile", itemKey: "b1", label: "Contract for sale" },
  { field: "comparableSalesFile", itemKey: "a4b", label: "Comparable sales report" },
];

function YesNo({ name, label, help }: { name: string; label: string; help?: string }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-rc-ink">{label}</legend>
      {help && <p className="mt-0.5 text-xs text-rc-muted">{help}</p>}
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

function DocUpload({
  name,
  label,
  onChange,
}: {
  name: string;
  label: string;
  onChange: (file: File | null) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-rc-ink">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type="file"
        required
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
        className="mt-1.5 w-full text-xs text-rc-muted file:mr-2 file:rounded-md file:border file:border-rc-border file:bg-white file:px-2 file:py-1.5 file:text-xs file:font-medium"
      />
    </div>
  );
}

// Plain text field, but as the agent types it debounces a call out to
// Google Places (via the searchAddress Server Action — the API key stays
// server-side, see src/lib/actions/places.ts) and offers a dropdown of
// matching addresses. Selecting one fills the field with Google's
// formatted text; the agent can otherwise just keep typing and ignore the
// dropdown entirely — this never blocks manual entry, since the API key
// might not be configured, the network might hiccup, or Google might
// simply not have this address.
function AddressAutocomplete({ defaultValue }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(next: string) {
    setValue(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = next.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      const results = await searchAddress(trimmed);
      if (requestIdRef.current !== requestId) return; // a newer keystroke has since fired
      setSuggestions(results);
      setOpen(results.length > 0);
    }, 300);
  }

  return (
    <div className="relative">
      <label htmlFor="address" className="block text-sm font-medium text-rc-ink">
        Property address
      </label>
      <input
        id="address"
        name="address"
        type="text"
        required
        autoComplete="off"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="6/2C Amor Street, Asquith NSW 2077"
        className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
      />
      {open && (
        <ul className="absolute z-10 mt-1 w-full rounded-card border border-rc-border bg-white py-1 text-sm shadow-card-lg">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={() => {
                  setValue(s.text);
                  setSuggestions([]);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-rc-bg-alt"
              >
                {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Property creation bundles the setup questions with up to three document
// uploads in one submit. The documents are uploaded straight from the
// browser to Storage (not through the createProperty Server Action) before
// that action ever runs, because Vercel Functions hard-cap every request
// body at 4.5MB — nowhere near enough for a real contract or agency
// agreement. createProperty only ever receives the resulting storage paths
// as plain strings; see src/lib/storage/evidence.ts and
// src/lib/actions/properties.ts for the rest of this flow.
export function NewPropertyForm({ agencyId }: { agencyId: string }) {
  const [state, formAction, pending] = useActionState(createProperty, initialState);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [stagingId] = useState(() => crypto.randomUUID());

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form) return;

    const missing = DOC_FIELDS.filter(({ field }) => !files[field]);
    if (missing.length > 0) {
      setUploadError("Attach all three documents to create the listing.");
      return;
    }

    setUploadError(null);
    setUploading(true);
    const supabase = createBrowserClient();

    const fd = new FormData(form);
    for (const { field, itemKey } of DOC_FIELDS) {
      const file = files[field];
      if (!file) continue; // unreachable — guarded above
      const path = buildStagingPath(agencyId, stagingId, itemKey, file.name);
      const { error } = await uploadEvidenceObject(supabase, { path, file });
      if (error) {
        setUploadError(`${file.name}: ${error}`);
        setUploading(false);
        return;
      }
      fd.delete(field);
      fd.set(`${field}StagedPath`, path);
      fd.set(`${field}FileName`, file.name);
    }

    setUploading(false);
    formAction(fd);
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10">
      <Link href="/dashboard" className="text-sm text-rc-muted transition hover:text-rc-ink hover:underline">
        ← Back to properties
      </Link>
      <h1 className="mt-3 text-xl font-semibold text-rc-ink">Add a listing</h1>
      <p className="mt-1 text-sm text-rc-muted">
        These answers unlock the right checklist items for this listing — e.g. the
        tenancy notice items, or the strata pool-certificate exemption.
      </p>

      <form ref={formRef} onSubmit={handleSubmit} className="mt-8 space-y-6">
        {(uploadError ?? state.error) && (
          <p className="rounded-2xl border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2 text-sm text-rc-amber-deep">
            {uploadError ?? state.error}
          </p>
        )}

        <AddressAutocomplete />

        <div>
          <label htmlFor="propertyType" className="block text-sm font-medium text-rc-ink">
            Property type
          </label>
          <select
            id="propertyType"
            name="propertyType"
            defaultValue="House"
            className="mt-1 w-full rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
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
        <YesNo
          name="agentInterest"
          label="Does Agent's Interest need to be disclosed?"
          help="Yes if you, or someone related to you, has or may obtain a beneficial interest in this property (s49) — e.g. you're buying it yourself."
        />

        <div className="border-t border-rc-border pt-6">
          <h2 className="text-sm font-semibold text-rc-ink">Documents</h2>
          <div className="mt-4 space-y-4">
            {DOC_FIELDS.map(({ field, label }) => (
              <DocUpload
                key={field}
                name={field}
                label={label}
                onChange={(file) => setFiles((prev) => ({ ...prev, [field]: file }))}
              />
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={pending || uploading}
          className="w-full rounded-full bg-rc-green-deep px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {uploading ? "Uploading documents…" : pending ? "Creating…" : "Create listing"}
        </button>
      </form>
    </main>
  );
}
