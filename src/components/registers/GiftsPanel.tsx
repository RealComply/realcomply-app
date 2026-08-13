"use client";

import { useActionState, useState } from "react";
import { addGift, markGiftReviewed, deleteGift, updateGiftThreshold, type ActionState } from "@/lib/actions/registers";
import type { Gift, Profile } from "@/lib/types";

const initialState: ActionState = { error: null };

const STATUS_STYLES: Record<string, string> = {
  recorded: "bg-rc-green/10 text-rc-green-deep",
  flagged: "bg-red-100 text-red-700",
  reviewed: "bg-rc-amber/10 text-rc-amber-deep",
};
const STATUS_LABELS: Record<string, string> = {
  recorded: "Recorded",
  flagged: "Review — over threshold",
  reviewed: "Flagged · reviewed",
};

export function GiftsPanel({
  gifts,
  staff,
  threshold,
  viewerProfile,
  autoOpenAdd = false,
}: {
  gifts: Gift[];
  staff: Profile[];
  threshold: number;
  viewerProfile: Profile;
  // Opens the "Record a gift / benefit" form straight away — used by the
  // Home page's "+ Log a gift" shortcut (?tab=gifts&add=1) so an agent
  // coming from there lands on a ready-to-fill form, not just the tab.
  autoOpenAdd?: boolean;
}) {
  const [adding, setAdding] = useState(autoOpenAdd);
  const [state, formAction, pending] = useActionState(addGift, initialState);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdState, thresholdAction, thresholdPending] = useActionState(updateGiftThreshold, initialState);

  const flaggedCount = gifts.filter((g) => g.status === "flagged").length;
  const overThresholdCount = gifts.filter((g) => g.value !== null && g.value > threshold).length;
  const clearedCount = gifts.filter((g) => g.status !== "flagged").length;

  const nameFor = (id: string) => staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "Unknown";

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile n={gifts.length} l="Entries" />
        <Tile n={overThresholdCount} l={`Over $${threshold} threshold`} warn />
        <Tile n={flaggedCount} l="Pending licensee review" bad={flaggedCount > 0} />
        <Tile n={clearedCount} l="Recorded & cleared" ok />
        <Tile
          n={
            editingThreshold ? (
              <form
                action={async (fd) => {
                  await thresholdAction(fd);
                  setEditingThreshold(false);
                }}
                className="flex items-center gap-1"
              >
                <input
                  type="number"
                  name="giftThreshold"
                  defaultValue={threshold}
                  className="w-16 rounded border border-rc-border px-1 py-0.5 text-sm"
                />
                <button type="submit" disabled={thresholdPending} className="text-xs text-rc-green-deep">
                  ✓
                </button>
              </form>
            ) : (
              `$${threshold}`
            )
          }
          l="Disclosure threshold"
          onClick={viewerProfile.is_licensee_in_charge && !editingThreshold ? () => setEditingThreshold(true) : undefined}
        />
      </div>
      {thresholdState.error && <p className="mt-1 text-xs text-rc-amber-deep">{thresholdState.error}</p>}

      <div className="mt-4 rounded-card border border-rc-border bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-rc-ink">Gifts &amp; benefits register</h3>
            <p className="mt-0.5 text-xs text-rc-muted">
              Recorded to manage conflicts of interest and probity under the Rules of Conduct.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="text-xs font-medium text-rc-green-deep hover:underline"
          >
            {adding ? "Cancel" : "+ Record a gift / benefit"}
          </button>
        </div>

        {adding && (
          <form
            action={async (fd) => {
              await formAction(fd);
              setAdding(false);
            }}
            className="mt-3 space-y-2 rounded-md border border-rc-border p-3"
          >
            <div className="flex flex-wrap gap-2">
              <select name="profileId" defaultValue={viewerProfile.id} className="rounded-md border border-rc-border px-2 py-1 text-sm">
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name ?? s.email}
                  </option>
                ))}
              </select>
              <input type="date" name="giftDate" required className="rounded-md border border-rc-border px-2 py-1 text-sm" />
              <select name="direction" className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="received">Received</option>
                <option value="given">Given</option>
              </select>
            </div>
            <input
              type="text"
              name="description"
              placeholder="What was it (e.g. 'Case of wine')"
              required
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="counterparty"
                placeholder="From/to whom"
                className="w-48 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input
                type="number"
                step="0.01"
                name="value"
                placeholder="Approx value ($)"
                className="w-32 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
            </div>
            <textarea name="notes" placeholder="Notes (optional)" rows={1} className="w-full rounded-md border border-rc-border px-2 py-1 text-sm" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
            {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
          </form>
        )}

        <div className="mt-3 overflow-x-auto">
          {gifts.length === 0 ? (
            <p className="text-sm text-rc-muted">No entries yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rc-border text-left text-xs uppercase tracking-wide text-rc-faint">
                  <th className="pb-2 pr-3">Date</th>
                  <th className="pb-2 pr-3">Agent</th>
                  <th className="pb-2 pr-3">Gift / benefit</th>
                  <th className="pb-2 pr-3">Counterparty</th>
                  <th className="pb-2 pr-3">Value</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((g) => (
                  <tr key={g.id} className="border-b border-neutral-100">
                    <td className="py-2 pr-3">{g.gift_date}</td>
                    <td className="py-2 pr-3">{nameFor(g.profile_id)}</td>
                    <td className="py-2 pr-3">
                      {g.description} <span className="text-xs text-rc-faint">({g.direction})</span>
                    </td>
                    <td className="py-2 pr-3 text-rc-muted">{g.counterparty ?? "—"}</td>
                    <td className="py-2 pr-3">{g.value ? `~$${g.value}` : "—"}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[g.status]}`}>
                        {STATUS_LABELS[g.status]}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      {viewerProfile.is_licensee_in_charge && (
                        <div className="flex justify-end gap-2">
                          {g.status === "flagged" && (
                            <form action={markGiftReviewed.bind(null, g.id)}>
                              <button type="submit" className="text-xs text-rc-green-deep hover:underline">
                                Mark reviewed
                              </button>
                            </form>
                          )}
                          <form action={deleteGift.bind(null, g.id)}>
                            <button type="submit" className="text-xs text-rc-faint hover:text-rc-amber-deep">
                              Remove
                            </button>
                          </form>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({
  n,
  l,
  ok,
  warn,
  bad,
  onClick,
}: {
  n: number | React.ReactNode;
  l: string;
  ok?: boolean;
  warn?: boolean;
  bad?: boolean;
  onClick?: () => void;
}) {
  const color = bad ? "text-red-700" : warn ? "text-rc-amber-deep" : ok ? "text-rc-green-deep" : "text-rc-ink";
  return (
    <div
      className={`rounded-card border border-rc-border bg-white p-4 shadow-card ${onClick ? "cursor-pointer hover:shadow-card-lg" : ""}`}
      onClick={onClick}
    >
      <div className={`text-xl font-bold tracking-tight ${color}`}>{n}</div>
      <div className="mt-0.5 text-[11px] font-medium text-rc-muted">{l}</div>
    </div>
  );
}
