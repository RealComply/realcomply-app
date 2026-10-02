"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X, Check } from "lucide-react";
import { DictateButton, appendDictated } from "@/components/Dictate";
import {
  addListing,
  removeListing,
  setListingNote,
  setListingWeighting,
  setNoneOnMarket,
  type ListingActionState,
} from "@/lib/actions/market-listings";
import { differencesFrom, similaritiesFrom, hasSubjectDetail, type SubjectAttributes } from "@/lib/data/comparables";
import {
  daysOnMarket,
  onMarketHeading,
  type ListingWeighting,
  type MarketListing,
} from "@/lib/data/market-listings";

// Properties on the market, under the comparable sales on the ESP reasoning
// card. Stephen Borg, 28 Sep 2026: the price reasoning should consider the
// competition as well as what has sold. Mockup v2 approved by Adam 28 Sep;
// design in RealComply-on-market-properties-design.md.
//
// Deliberately the same look as the sales list (Adam: no separate colour) so
// the agent reads one way of working, not two.
//
// TWO MARKS, NOT THREE (Adam, 29 Sep 2026). No "not comparable": if a listing
// isn't comparable it shouldn't be on the list, so the agent removes it.
// Nothing is pre-selected — a defaulted mark is a decision nobody made.

const initial: ListingActionState = { error: null };

const MARKS: Array<{ value: ListingWeighting; label: string; help: string }> = [
  {
    value: "competition",
    label: "Direct competition",
    help: "A buyer for this property would be weighing this one too",
  },
  { value: "considered", label: "Considered", help: "You looked at it; it was not decisive" },
];

function spec(l: MarketListing): string {
  const bits: string[] = [];
  if (l.bedrooms !== null) bits.push(`${l.bedrooms} bed`);
  if (l.bathrooms !== null) bits.push(`${l.bathrooms} bath`);
  if (l.carSpaces !== null) bits.push(`${l.carSpaces} car`);
  if (l.landSizeSqm !== null) bits.push(`${Math.round(l.landSizeSqm)}m² land`);
  return bits.join(" · ");
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km away` : `${Math.round(metres)}m away`;
}

export function MarketListingsPanel({
  propertyId,
  subject,
  listings,
  agreementDate,
  noneOnMarket = false,
}: {
  propertyId: string;
  subject: SubjectAttributes;
  listings: MarketListing[];
  /** The agency agreement date off a3. The list is "as at" this date. */
  agreementDate: string | null;
  /** The agent has confirmed nothing comparable was for sale at that date. */
  noneOnMarket?: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-4 space-y-3">
      <div>
        <p className="text-[12px] font-semibold text-rc-ink">{onMarketHeading(agreementDate)}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
          Other properties for sale that a buyer for this one would also be looking at. Prices here are other
          agents&rsquo; advertised prices or guides, not sale prices.
        </p>
      </div>

      {listings.length === 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-rc-muted">
            None read from the report yet. If your comparable-sales report lists properties for sale they&rsquo;ll
            appear here, or add one you know of yourself.
          </p>
          <NoneOnMarket propertyId={propertyId} confirmed={noneOnMarket} />
        </div>
      ) : (
        <div className="space-y-2">
          {listings.map((l) => (
            <ListingRow
              key={l.id}
              propertyId={propertyId}
              subject={subject}
              listing={l}
              agreementDate={agreementDate}
            />
          ))}
        </div>
      )}

      {adding ? (
        <AddListing propertyId={propertyId} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20"
        >
          <Plus size={12} aria-hidden="true" />
          Add a listing
        </button>
      )}
    </div>
  );
}

function ListingRow({
  propertyId,
  subject,
  listing,
  agreementDate,
}: {
  propertyId: string;
  subject: SubjectAttributes;
  listing: MarketListing;
  agreementDate: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(listing.agentNote ?? "");
  const [savedNote, setSavedNote] = useState(listing.agentNote ?? "");
  const [error, setError] = useState<string | null>(null);

  const similar = similaritiesFrom(subject, listing);
  const different = differencesFrom(subject, listing);
  const canCompare = similar.length > 0 || different.length > 0;
  const days = daysOnMarket(listing.listedDate, agreementDate);

  function mark(value: ListingWeighting) {
    setError(null);
    startTransition(async () => {
      const next = listing.weighting === value ? null : value;
      const result = await setListingWeighting(propertyId, listing.id, next);
      if (result.error) setError(result.error);
    });
  }

  function saveNote() {
    if (note === savedNote) return;
    setError(null);
    startTransition(async () => {
      const result = await setListingNote(propertyId, listing.id, note);
      if (result.error) setError(result.error);
      else setSavedNote(note);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeListing(propertyId, listing.id);
      if (result.error) setError(result.error);
    });
  }

  const facts = [
    listing.askingPrice?.trim() || "No price advertised",
    listing.saleMethod?.trim() || null,
    days !== null ? `${days} ${days === 1 ? "day" : "days"} on market` : null,
    spec(listing) || null,
    listing.distanceM !== null ? formatDistance(listing.distanceM) : null,
  ].filter(Boolean);

  return (
    <div
      className={`rounded-md border px-2.5 py-2 transition ${
        listing.weighting === "competition" ? "border-rc-green-deep/35 bg-rc-green-soft/40" : "border-rc-border bg-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-rc-ink">{listing.address}</p>
          <p className="mt-0.5 text-[11px] text-rc-muted">{facts.join(" · ")}</p>
          {listing.source === "agent" && (
            <p className="mt-0.5 text-[11px] text-rc-faint">Added by you, not from the report.</p>
          )}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Remove ${listing.address}`}
          title="Remove this listing — if it isn't comparable, it doesn't belong on the list."
          className="shrink-0 rounded-full p-1 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink disabled:opacity-50"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      {canCompare ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-rc-border bg-white px-2 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-rc-green-deep">Similar</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {similar.length > 0 ? (
                similar.map((t) => (
                  <span key={t} className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] text-rc-green-deep">
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[11px] italic text-rc-faint">Nothing matches</span>
              )}
            </div>
          </div>
          <div className="rounded-md border border-rc-border bg-white px-2 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-rc-amber-deep">Different</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {different.length > 0 ? (
                different.map((t) => (
                  <span key={t} className="rounded-full bg-rc-amber/15 px-2 py-0.5 text-[11px] text-rc-amber-deep">
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[11px] italic text-rc-faint">No differences on the details recorded</span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-md border border-rc-border bg-white px-2 py-1.5 text-[11px] italic text-rc-faint">
          {hasSubjectDetail(subject)
            ? "No bed, bath or land figures for this one — nothing to compare."
            : "Add this listing's own details above and each property will be compared against them."}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {MARKS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => mark(m.value)}
            disabled={pending}
            title={m.help}
            aria-pressed={listing.weighting === m.value}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
              listing.weighting === m.value
                ? "bg-rc-green-deep text-white"
                : "border border-rc-border bg-white text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
            }`}
          >
            {listing.weighting === m.value && <Check size={10} aria-hidden="true" />}
            {m.label}
          </button>
        ))}
      </div>

      {listing.weighting && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            rows={2}
            placeholder="How it compares with this property — one line is enough"
            className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm leading-relaxed text-rc-ink"
          />
          <div className="mt-1 flex items-center gap-2">
            <DictateButton onText={(text) => setNote((n) => appendDictated(n, text))} label="Dictate" />
            {note !== savedNote && (
              <button
                type="button"
                onClick={saveNote}
                disabled={pending}
                className="text-[11px] font-semibold text-rc-green-deep hover:underline disabled:opacity-60"
              >
                Save
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {error}
        </p>
      )}
    </div>
  );
}

function Field({ name, label }: { name: string; label: string }) {
  return (
    <label className="block text-[11px] font-medium text-rc-muted">
      {label}
      <input
        type="text"
        inputMode="decimal"
        name={name}
        className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
      />
    </label>
  );
}

function AddListing({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const boundAction = addListing.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(
    async (prev: ListingActionState, fd: FormData) => {
      const result = await boundAction(prev, fd);
      if (!result.error) onDone();
      return result;
    },
    initial,
  );

  return (
    <form action={formAction} className="rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2">
      <p className="text-[11px] font-semibold text-rc-ink">Add a listing</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
        One on the market that the report missed. Address is all that&rsquo;s required.
      </p>
      <input
        type="text"
        name="address"
        required
        placeholder="14 Smith St, Mount Colah"
        className="mt-2 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="col-span-2 block text-[11px] font-medium text-rc-muted sm:col-span-1">
          Advertised price or guide
          <input
            type="text"
            name="askingPrice"
            placeholder="$1.2m–$1.3m"
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
          />
        </label>
        <label className="block text-[11px] font-medium text-rc-muted">
          Sale method
          <input
            type="text"
            name="saleMethod"
            placeholder="Auction"
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
          />
        </label>
        <label className="block text-[11px] font-medium text-rc-muted">
          Listed
          <input
            type="date"
            name="listedDate"
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
          />
        </label>
        <Field name="bedrooms" label="Beds" />
        <Field name="bathrooms" label="Baths" />
        <Field name="carSpaces" label="Car" />
        <Field name="landSizeSqm" label="Land m²" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={onDone} className="text-[11px] font-semibold text-rc-muted hover:text-rc-ink">
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * "There was nothing comparable for sale at the agreement date." An empty list
 * alone says nothing — the report may not have listed any — so the agent says
 * it, and "Draft my reasoning" can then state it as a fact they checked.
 */
function NoneOnMarket({ propertyId, confirmed }: { propertyId: string; confirmed: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <label className="flex items-start gap-2 text-[11px] text-rc-ink">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked;
            startTransition(async () => {
              const result = await setNoneOnMarket(propertyId, next);
              setError(result.error);
            });
          }}
          className="mt-0.5 shrink-0 accent-rc-green-deep"
        />
        <span>Nothing comparable was on the market at the agreement date</span>
      </label>
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {error}
        </p>
      )}
    </div>
  );
}
