"use client";

import { useState } from "react";
import type { SaleMethod } from "@/lib/types";

/**
 * How the property is being sold — the one new question at listing set-up,
 * and the switch that every auction item hangs off.
 *
 * Shared between NewPropertyForm and EditPropertyDetails so the two can never
 * drift: the edit panel is where a private-treaty listing becomes an auction
 * (and where the date fills in once it is finally set), so it has to offer
 * exactly the same fields.
 *
 * The date and time are optional on purpose (Adam, 18 Aug 2026): a listing
 * very often goes to auction before the date is fixed, and forcing one would
 * only produce invented dates in a compliance record. Null reads as TBC and
 * the file says so.
 */
export function SaleMethodFields({
  defaultMethod = "private_treaty",
  defaultDate = null,
  defaultTime = null,
  defaultVenue = null,
  compact = false,
}: {
  defaultMethod?: SaleMethod;
  defaultDate?: string | null;
  defaultTime?: string | null;
  defaultVenue?: string | null;
  compact?: boolean;
}) {
  const [method, setMethod] = useState<SaleMethod>(defaultMethod);

  return (
    <fieldset>
      <legend className={compact ? "text-xs font-medium text-rc-ink" : "text-sm font-medium text-rc-ink"}>
        How is this property being sold?
      </legend>
      <div className="mt-2 flex gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="saleMethod"
            value="private_treaty"
            checked={method === "private_treaty"}
            onChange={() => setMethod("private_treaty")}
            className="accent-rc-green-deep"
          />
          Private treaty
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="saleMethod"
            value="auction"
            checked={method === "auction"}
            onChange={() => setMethod("auction")}
            className="accent-rc-green-deep"
          />
          Auction
        </label>
      </div>

      {method === "auction" && (
        <div className="mt-3 rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-3">
          <div className="flex flex-wrap gap-2">
            <label className="min-w-[9rem] flex-1">
              <span className="block text-xs text-rc-muted">Auction date</span>
              <input
                type="date"
                name="auctionDate"
                defaultValue={defaultDate ?? ""}
                className="mt-1 w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="w-32">
              <span className="block text-xs text-rc-muted">Time</span>
              <input
                type="text"
                name="auctionTime"
                placeholder="10:00am"
                defaultValue={defaultTime ?? ""}
                className="mt-1 w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm"
              />
            </label>
            <label className="w-36">
              <span className="block text-xs text-rc-muted">Where</span>
              <select
                name="auctionVenue"
                defaultValue={defaultVenue ?? ""}
                className="mt-1 w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="On site">On site</option>
                <option value="In rooms">In rooms</option>
                <option value="Online">Online</option>
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-rc-muted">
            Leave the date blank if it isn&rsquo;t set yet — the listing will show{" "}
            <span className="font-medium text-rc-ink">date TBC</span> until you fill it in. If it&rsquo;s in the
            agency agreement, RealComply reads it from there when it reads the document.
          </p>
        </div>
      )}
    </fieldset>
  );
}
