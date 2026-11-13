"use client";

import { useActionState } from "react";
import { rereadCmaReport, testReadCmaReport, type CmaRereadState } from "@/lib/actions/cma-reread-admin";
import type { CmaRereadListing } from "@/lib/documents/cma-reread";
import { formatAuDateTimeShort } from "@/lib/format-date";

// The comparable-sales reports Adam asked to have re-read (2 Nov 2026), each
// with its own button, and the ones to test-read with nothing saved (Master,
// 11 Nov 2026). See lib/documents/cma-reread.

const button =
  "inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";
const quietButton =
  "inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-4 py-2 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60";

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function lastReadLine(l: CmaRereadListing): string {
  const onListing = `On the listing: ${plural(l.salesOnListing, "sale")}, ${plural(l.listingsOnListing, "listing")} on the market.`;
  const r = l.lastRead;
  if (!r) return `${onListing} No read of this file is recorded.`;
  const when = formatAuDateTimeShort(r.at);
  switch (r.outcome) {
    case "read":
      return `${onListing} Last read ${when}: ${plural(r.sales ?? 0, "sale")}, ${plural(r.listings ?? 0, "listing")}.`;
    case "nothing_found":
      return `${onListing} Last read ${when}: nothing found.`;
    case "wrong_document":
      return `${onListing} Last read ${when}: not a comparable-sales report.`;
    case "failed":
      return `${onListing} Last read ${when}: couldn't be read.`;
  }
}

function Said({ state }: { state: CmaRereadState }) {
  return (
    <>
      {state.error && (
        <p role="alert" className="mt-2 whitespace-pre-line text-xs font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="mt-2 whitespace-pre-line text-xs font-medium text-rc-green-deep">
          {state.notice}
        </p>
      )}
    </>
  );
}

function Reread({ listing }: { listing: CmaRereadListing }) {
  const [state, reread, reading] = useActionState(rereadCmaReport, { error: null } as CmaRereadState);
  const [tested, testRead, testing] = useActionState(testReadCmaReport, { error: null } as CmaRereadState);
  const [agreementTested, testReadAgreement, testingAgreement] = useActionState(testReadCmaReport, {
    error: null,
  } as CmaRereadState);
  const busy = reading || testing || testingAgreement;
  return (
    <li className="rounded-lg border border-rc-border px-3 py-2.5">
      <p className="text-sm font-semibold text-rc-ink">{listing.address}</p>
      <p className="text-xs text-rc-muted">
        {listing.office} · {listing.fileName ?? "No report on the ESP card"}
        {listing.ended ? " · Subscription ended, so not re-read" : ""}
      </p>
      <p className="mt-1 text-xs text-rc-muted">{lastReadLine(listing)}</p>
      {listing.fileName && (
        <div className="mt-2 flex flex-wrap gap-2">
          {!listing.testOnly && !listing.ended && (
            <form action={reread}>
              <input type="hidden" name="propertyId" value={listing.propertyId} />
              <button type="submit" disabled={busy} className={button}>
                {reading ? "Reading the report…" : "Re-read report"}
              </button>
            </form>
          )}
          <form action={testRead}>
            <input type="hidden" name="propertyId" value={listing.propertyId} />
            <button type="submit" disabled={busy} className={quietButton}>
              {testing ? "Test reading…" : "Test read (nothing saved)"}
            </button>
          </form>
          {/* The agency agreement's own sales page (decision 6, 11 Nov 2026). */}
          <form action={testReadAgreement}>
            <input type="hidden" name="propertyId" value={listing.propertyId} />
            <input type="hidden" name="from" value="agreement" />
            <button type="submit" disabled={busy} className={quietButton}>
              {testingAgreement ? "Test reading the agreement…" : "Test read agreement (nothing saved)"}
            </button>
          </form>
        </div>
      )}
      <Said state={state} />
      <Said state={tested} />
      <Said state={agreementTested} />
    </li>
  );
}

export function CmaRereads({ listings }: { listings: CmaRereadListing[] }) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Comparable-sales re-reads</p>
      <p className="mt-1 text-xs text-rc-muted">
        The listings whose report was read before the fix of 31 Oct and still show no sales (Adam, 2 Nov), and
        McGoldrick&rsquo;s, to test the reader that takes any format (Master, 11 Nov). A re-read adds the
        report&rsquo;s sales and listings on the market and puts the read&rsquo;s result on the ESP card. It never
        changes the ESP, a note, the reasoning, a tick, a card&rsquo;s status or the listing&rsquo;s details. A test
        read only says what the reader would take from the report, or from the agency agreement&rsquo;s own sales page:
        nothing is saved. Each takes up to a minute or two.
      </p>
      <ul className="mt-3 space-y-2">
        {listings.map((l) => (
          <Reread key={l.propertyId} listing={l} />
        ))}
      </ul>
    </div>
  );
}
