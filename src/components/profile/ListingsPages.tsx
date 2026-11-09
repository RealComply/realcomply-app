"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { keepListingsPage, saveListingsPage, type ListingsPageState } from "@/lib/actions/listings-pages";
import { AGENTS_PAGES_HELP, AGENTS_PAGES_TITLE, NOT_SET_LINE, PERSONAL_PAGE_HELP, PERSONAL_PAGE_LABEL } from "@/lib/listings-pages";

// An agent's own listings page for the daily price check (Adam, 2 Nov 2026;
// 0105). "My listings page" on Profile settings; "Agents' own listings pages"
// on the Office profile for whoever runs the office; and the group-page
// warning under any listings page, the office's included.

const INPUT =
  "min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";
const SAVE =
  "rounded-full bg-rc-green-deep px-4 py-2 text-sm font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";
const QUIET =
  "rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/30 disabled:opacity-60";

/** What the server worked out about one page this morning (lib/listings-pages.ts). */
export type PageState = {
  /** "Checked this morning: 12 listings found, 2 in RealComply", or when it will be. */
  line: string | null;
  /** The group-page warning, word for word, or null. */
  warning: string | null;
  /** listings_page_checks.page_key, for "Keep this one". */
  pageKey: string | null;
};

/** The group-page warning (Adam, 2 Nov 2026), with Update link and Keep this one. */
export function GroupPageWarning({
  text,
  pageKey,
  onUpdate,
}: {
  text: string;
  pageKey: string;
  onUpdate: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  if (kept) return null;
  return (
    <div role="alert" className="mt-2 rounded-lg border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2.5">
      <p className="text-xs leading-relaxed text-rc-ink">{text}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={QUIET} onClick={onUpdate} disabled={pending}>
          Update link
        </button>
        <button
          type="button"
          className={QUIET}
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await keepListingsPage(pageKey);
              if (result.error) setError(result.error);
              else setKept(true);
            });
          }}
        >
          {pending ? "Keeping…" : "Keep this one"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rc-amber-deep">{error}</p>}
    </div>
  );
}

function CheckAndWarning({ state, onUpdate }: { state: PageState; onUpdate: () => void }) {
  return (
    <>
      {state.line && <p className="mt-2 text-xs text-rc-muted">{state.line}</p>}
      {state.warning && state.pageKey && <GroupPageWarning text={state.warning} pageKey={state.pageKey} onUpdate={onUpdate} />}
    </>
  );
}

/** The personal listings page, in My details, for anyone who lists properties (Adam, 8 Nov 2026: the sign-up's words). */
export function MyListingsPageField({ current, state }: { current: string | null; state: PageState }) {
  const [result, action, pending] = useActionState<ListingsPageState, FormData>(saveListingsPage, {
    error: null,
    saved: false,
  });
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={action} className="mt-5 border-t border-rc-border pt-4">
      <label htmlFor="myListingsPage" className="block text-sm font-semibold text-rc-ink">
        {PERSONAL_PAGE_LABEL}
      </label>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">{PERSONAL_PAGE_HELP}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          ref={input}
          id="myListingsPage"
          name="listingsPage"
          // Not type="url": people type "raineandhorne.com.au/agents/jo", and
          // the server makes it a full address (lib/normalise-url.ts).
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={current ?? ""}
          placeholder="youroffice.com.au/agents/your-name"
          className={INPUT}
        />
        <button type="submit" disabled={pending} className={SAVE}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {result.error && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {result.error}
        </p>
      )}
      {result.saved && !result.error && (
        <p className="mt-2 text-sm font-medium text-rc-green-deep" role="status">
          Saved.
        </p>
      )}
      <CheckAndWarning state={state} onUpdate={() => input.current?.focus()} />
    </form>
  );
}

/** Under the office listings page field: this morning's check of the office page, and the warning. */
export function OfficePageCheck({ state }: { state: PageState }) {
  return (
    <CheckAndWarning
      state={state}
      onUpdate={() => {
        const field = document.getElementById("websiteUrl") as HTMLInputElement | null;
        field?.scrollIntoView({ block: "center" });
        field?.focus();
      }}
    />
  );
}

export type AgentPageRow = {
  profileId: string;
  name: string;
  url: string | null;
  state: PageState;
};

function AgentRow({ row }: { row: AgentPageRow }) {
  const [editing, setEditing] = useState(false);
  const [result, action, pending] = useActionState<ListingsPageState, FormData>(
    async (prev: ListingsPageState, formData: FormData) => {
      const next = await saveListingsPage(prev, formData);
      if (next.saved) setEditing(false);
      return next;
    },
    { error: null, saved: false },
  );
  const fieldId = `agentPage-${row.profileId}`;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rc-ink">{row.name}</p>
          {row.url ? (
            <p className="mt-0.5 break-all text-xs text-rc-muted">{row.url}</p>
          ) : (
            <p className="mt-0.5 text-xs text-rc-muted">{NOT_SET_LINE}</p>
          )}
        </div>
        {!editing && (
          <button type="button" className={QUIET} onClick={() => setEditing(true)}>
            {row.url ? "Change" : "Add"}
          </button>
        )}
      </div>
      {editing && (
        <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
          <input type="hidden" name="profileId" value={row.profileId} />
          <label htmlFor={fieldId} className="sr-only">
            {row.name}&rsquo;s personal listings page
          </label>
          <input
            id={fieldId}
            name="listingsPage"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            defaultValue={row.url ?? ""}
            placeholder="youroffice.com.au/agents/their-name"
            className={INPUT}
            autoFocus
          />
          <button type="submit" disabled={pending} className={SAVE}>
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" className={QUIET} onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </button>
        </form>
      )}
      {result.error && (
        <p className="mt-2 text-sm text-rc-amber-deep" role="alert">
          {result.error}
        </p>
      )}
      {row.url && <CheckAndWarning state={row.state} onUpdate={() => setEditing(true)} />}
    </li>
  );
}

/** Office profile: every lister's own page, for the licensee in charge and an office manager. */
export function AgentsListingsPagesCard({ rows }: { rows: AgentPageRow[] }) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <h3 className="text-sm font-semibold text-rc-ink">{AGENTS_PAGES_TITLE}</h3>
      <p className="mt-1 text-xs leading-relaxed text-rc-muted">{AGENTS_PAGES_HELP}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-rc-muted">No agents in the office yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-rc-border">
          {rows.map((row) => (
            <AgentRow key={row.profileId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
