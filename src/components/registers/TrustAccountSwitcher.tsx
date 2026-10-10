"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Archive } from "lucide-react";
import {
  createTrustAccount,
  renameTrustAccount,
  setTrustAccountArchived,
  type ActionState,
} from "@/lib/actions/trust-account";
import type { TrustAccount } from "@/lib/types";

// Which trust account you are looking at, and the controls for managing them.
//
// Adam, 25 Aug 2026: "they can add the trust account, and then they get to name
// it whatever they want. So it could just be sales or property management or
// sometimes companies run property management if it's a large enough portfolio
// through several companies."
//
// Hence free text and no fixed list. "Sales", "Property management",
// "PM — Hornsby": an agency running three rent rolls through three companies
// knows their names better than we do.
//
// Selection is a URL parameter rather than state, so a link to one account is a
// real link — the Monday digest and a reminder email can both point at the
// account they are about.

const initial: ActionState = { error: null };

export function TrustAccountSwitcher({
  accounts,
  activeId,
  canManage,
  toneOf,
  closedAccounts = [],
}: {
  accounts: TrustAccount[];
  activeId: string;
  canManage: boolean;
  /** Red where something is overdue on that account, amber where it is waiting. */
  toneOf: Record<string, "red" | "amber" | null>;
  /** Closed accounts not already in `accounts`, listed so they can be opened and reopened. */
  closedAccounts?: TrustAccount[];
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Which account a "close it?" question is open for. By id, so it cannot
  // carry over to the next account once the page re-renders without it.
  const [confirmingClose, setConfirmingClose] = useState<string | null>(null);
  const [createState, create, creating] = useActionState(createTrustAccount, initial);
  const [renameState, rename, saving] = useActionState(renameTrustAccount, initial);
  // Kept, not thrown away (10 Oct 2026): a refused close used to show nothing.
  const [archiveState, archive, archiving] = useActionState(setTrustAccountArchived, initial);

  const active = accounts.find((a) => a.id === activeId);

  return (
    <div className="border-b border-rc-border bg-rc-bg-alt px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {accounts.map((a) => {
          const tone = toneOf[a.id] ?? null;
          const on = a.id === activeId;
          return (
            <a
              key={a.id}
              href={`/dashboard/trust?account=${a.id}`}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                on
                  ? "border-transparent bg-rc-green-deep text-white"
                  : "border-rc-border bg-white text-rc-muted hover:border-rc-ink/15 hover:text-rc-ink"
              }`}
            >
              {tone && (
                <span
                  aria-hidden="true"
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                    tone === "red" ? "bg-rc-red" : "bg-rc-amber"
                  } ${on ? "ring-[1.5px] ring-white/40" : ""}`}
                />
              )}
              {a.name}
              {tone && <span className="sr-only"> — something outstanding</span>}
            </a>
          );
        })}

        {canManage && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-rc-border px-3.5 py-2 text-sm font-bold text-rc-green-deep transition hover:border-rc-green-deep"
          >
            <Plus size={14} strokeWidth={2.6} aria-hidden="true" /> Add a trust account
          </button>
        )}
      </div>

      {/* Closed accounts, each a link to its own page (10 Oct 2026). Without
          this a closed account could only be reached by typing its address,
          which nothing ever showed — and Reopen lives on that page. */}
      {closedAccounts.length > 0 && (
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-rc-faint">
          <span>Closed:</span>
          {closedAccounts.map((a) => (
            <a
              key={a.id}
              href={`/dashboard/trust?account=${a.id}`}
              className="font-medium text-rc-muted transition hover:text-rc-ink hover:underline"
            >
              {a.name}
            </a>
          ))}
        </p>
      )}

      {canManage && adding && (
        <form action={create} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="name"
            autoFocus
            placeholder="What do you call it? e.g. Property management — Hornsby"
            className="min-w-[240px] flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
          />
          <OpenedOnField />
          <button
            type="submit"
            disabled={creating}
            className="rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {creating ? "Adding…" : "Add account"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded-full border border-rc-border bg-white px-4 py-2 text-xs font-medium text-rc-muted"
          >
            Cancel
          </button>
        </form>
      )}

      {/* Rename and close sit under the switcher rather than on each chip —
          they are rare, and putting them on every chip would make an ordinary
          switch feel like a dangerous one. */}
      {canManage && active && !adding && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {renaming === active.id ? (
            <form action={rename} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="accountId" value={active.id} />
              <input type="hidden" name="openedOnWas" value={active.opened_on ?? ""} />
              <input
                name="name"
                autoFocus
                defaultValue={active.name}
                className="min-w-[200px] rounded-lg border border-rc-border px-3 py-1.5 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
              />
              <OpenedOnField defaultValue={active.opened_on ?? ""} />
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-rc-green-deep px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setRenaming(null)}
                className="text-rc-faint hover:text-rc-ink"
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              {/* "Edit" since 10 Oct 2026: the form also holds the date it opened. */}
              <button
                type="button"
                onClick={() => setRenaming(active.id)}
                className="inline-flex items-center gap-1.5 font-medium text-rc-muted transition hover:text-rc-ink"
              >
                <Pencil size={12} aria-hidden="true" /> Edit {active.name}
              </button>
              {active.archived_at ? (
                // Clears the "close it?" question on the way back (10 Oct
                // 2026). It was answered when the account closed, but the page
                // refreshes in place and kept it, so reopening put "Close it"
                // straight back on screen: one click from closing again.
                <form action={archive} onSubmit={() => setConfirmingClose(null)}>
                  <input type="hidden" name="accountId" value={active.id} />
                  <input type="hidden" name="archived" value="no" />
                  <button
                    type="submit"
                    disabled={archiving}
                    className="inline-flex items-center gap-1.5 font-medium text-rc-faint transition hover:text-rc-amber-deep disabled:opacity-60"
                  >
                    <Archive size={12} aria-hidden="true" />
                    {archiving ? "Reopening…" : "Reopen this account"}
                  </button>
                </form>
              ) : confirmingClose === active.id ? (
                // Asked first (10 Oct 2026). It was one unconfirmed click beside
                // Rename, and the account then dropped out of the switcher.
                <form action={archive} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="accountId" value={active.id} />
                  <input type="hidden" name="archived" value="yes" />
                  <span className="text-rc-ink">
                    Close {active.name}? Nothing new is asked for on it. It stays listed under Closed, where it
                    can be reopened.
                  </span>
                  <button
                    type="submit"
                    disabled={archiving}
                    className="rounded-full bg-rc-amber-deep px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {archiving ? "Closing…" : "Close it"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingClose(null)}
                    className="text-rc-faint hover:text-rc-ink"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingClose(active.id)}
                  className="inline-flex items-center gap-1.5 font-medium text-rc-faint transition hover:text-rc-amber-deep"
                >
                  <Archive size={12} aria-hidden="true" />
                  Close this account
                </button>
              )}
              {/* Said out loud, because "close" reads like "delete" to most
                  people and this one deliberately is not. */}
              <span className="text-rc-faint">
                Closing keeps every reconciliation already filed against it.
              </span>
            </>
          )}
        </div>
      )}

      {(createState.error ?? renameState.error ?? archiveState.error) && (
        <p className="mt-2 text-xs text-rc-amber-deep" role="alert">
          {createState.error ?? renameState.error ?? archiveState.error}
        </p>
      )}
    </div>
  );
}

// The day the account opened (10 Oct 2026). Optional: blank means it was
// already open, and every month and audit is owed as before.
function OpenedOnField({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <label
      className="inline-flex items-center gap-1.5 text-xs text-rc-muted"
      title="Only if it opened recently. Months before this date are not asked for. Leave it blank if it was already open."
    >
      Opened on
      <input
        type="date"
        name="openedOn"
        defaultValue={defaultValue}
        className="rounded-lg border border-rc-border px-2 py-1.5 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
      />
      <span className="text-rc-faint">(if new)</span>
    </label>
  );
}
