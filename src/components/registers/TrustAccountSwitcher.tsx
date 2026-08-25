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
}: {
  accounts: TrustAccount[];
  activeId: string;
  canManage: boolean;
  /** Red where something is overdue on that account, amber where it is waiting. */
  toneOf: Record<string, "red" | "amber" | null>;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [createState, create, creating] = useActionState(createTrustAccount, initial);
  const [renameState, rename, saving] = useActionState(renameTrustAccount, initial);
  const [, archive] = useActionState(setTrustAccountArchived, initial);

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

      {canManage && adding && (
        <form action={create} className="mt-3 flex flex-wrap items-center gap-2">
          <input
            name="name"
            autoFocus
            placeholder="What do you call it? e.g. Property management — Hornsby"
            className="min-w-[240px] flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
          />
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
              <input
                name="name"
                autoFocus
                defaultValue={active.name}
                className="min-w-[200px] rounded-lg border border-rc-border px-3 py-1.5 text-sm text-rc-ink outline-none focus:border-rc-green-deep"
              />
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-rc-green-deep px-3.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save name"}
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
              <button
                type="button"
                onClick={() => setRenaming(active.id)}
                className="inline-flex items-center gap-1.5 font-medium text-rc-muted transition hover:text-rc-ink"
              >
                <Pencil size={12} aria-hidden="true" /> Rename {active.name}
              </button>
              <form action={archive}>
                <input type="hidden" name="accountId" value={active.id} />
                <input type="hidden" name="archived" value={active.archived_at ? "no" : "yes"} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 font-medium text-rc-faint transition hover:text-rc-amber-deep"
                >
                  <Archive size={12} aria-hidden="true" />
                  {active.archived_at ? "Reopen this account" : "Close this account"}
                </button>
              </form>
              {/* Said out loud, because "close" reads like "delete" to most
                  people and this one deliberately is not. */}
              <span className="text-rc-faint">
                Closing keeps every reconciliation already filed against it.
              </span>
            </>
          )}
        </div>
      )}

      {(createState.error ?? renameState.error) && (
        <p className="mt-2 text-xs text-rc-amber-deep" role="alert">
          {createState.error ?? renameState.error}
        </p>
      )}
    </div>
  );
}
