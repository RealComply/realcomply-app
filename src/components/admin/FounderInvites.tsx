"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Plus, X } from "lucide-react";
import {
  createFounderInvite,
  expireFounderInvite,
  type FounderInviteState,
} from "@/lib/actions/founder-invites";

// The founder invite list, with the two things that were missing: a way to make
// one, and a way to copy one.
//
// Adam, 9 Sep 2026, having gone looking for this in Team settings and found
// only the invite that adds somebody to HIS agency: "that's only to invite
// people into my team. Which isn't what I want to do."
//
// COPY BUTTONS, not a link to select by hand. The only thing anybody does with
// one of these is put it in a message, and a 32-character token half-selected
// with a mouse is a link that silently does not work — which reads to the
// recipient as a broken product rather than a slipped selection.

const initial: FounderInviteState = { error: null };

export type FounderInvite = {
  token: string;
  label: string;
  acceptedAt: string | null;
  expiresAt: string;
  agencyName: string | null;
  expired: boolean;
};

export function FounderInvites({ invites, siteUrl }: { invites: FounderInvite[]; siteUrl: string }) {
  const [state, formAction, pending] = useActionState(createFounderInvite, initial);
  const [copied, setCopied] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkFor = (token: string) => `${siteUrl}/signup?founder=${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000);
    } catch {
      // Clipboard access can be refused outright — an insecure context, or a
      // browser setting. Saying so beats a button that looks like it worked.
      setError("Couldn't copy automatically. Select the link and copy it by hand.");
    }
  }

  async function cancel(token: string) {
    setCancelling(token);
    setError(null);
    const { error: cancelError } = await expireFounderInvite(token);
    setCancelling(null);
    if (cancelError) setError(cancelError);
  }

  const ready = invites.filter((i) => !i.acceptedAt && !i.expired);
  const used = invites.filter((i) => i.acceptedAt);
  const dead = invites.filter((i) => !i.acceptedAt && i.expired);

  return (
    <div className="space-y-4">
      {/* MAKE ONE. At the top, because on this screen it is the thing being
          looked for — the list underneath is what you check afterwards. */}
      <form action={formAction} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
        <label htmlFor="label" className="block text-xs font-bold uppercase tracking-wide text-rc-faint">
          New invite
        </label>
        <p className="mt-1 text-xs text-rc-muted">
          One link, one new agency. They set up their own office — they never see yours.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <input
            id="label"
            name="label"
            type="text"
            required
            maxLength={120}
            placeholder="Dave — Ray White Hornsby"
            className="min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            <Plus size={13} aria-hidden="true" />
            {pending ? "Creating…" : "Create link"}
          </button>
        </div>
        {state.error && (
          <p role="alert" className="mt-2 text-xs font-medium text-rc-amber-deep">
            {state.error}
          </p>
        )}
      </form>

      {error && (
        <p role="alert" className="text-xs font-medium text-rc-amber-deep">
          {error}
        </p>
      )}

      <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
        {invites.length === 0 && (
          <p className="text-xs text-rc-muted">No invites yet. Create one above.</p>
        )}

        {ready.length > 0 && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">
              Ready to send ({ready.length})
            </p>
            <ul className="mt-2 space-y-2">
              {ready.map((invite) => (
                <li key={invite.token} className="rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-rc-ink">{invite.label}</p>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => copy(invite.token)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-rc-green-deep-600"
                      >
                        {copied === invite.token ? (
                          <>
                            <Check size={11} aria-hidden="true" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={11} aria-hidden="true" /> Copy link
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => cancel(invite.token)}
                        disabled={cancelling === invite.token}
                        title="Cancel this invite"
                        className="inline-flex items-center gap-1 rounded-full border border-rc-border bg-white px-2.5 py-1 text-[11px] font-semibold text-rc-muted transition hover:border-rc-ink/20 hover:text-rc-ink disabled:opacity-60"
                      >
                        <X size={11} aria-hidden="true" />
                        {cancelling === invite.token ? "…" : "Cancel"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed text-rc-muted">
                    {linkFor(invite.token)}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}

        {used.length > 0 && (
          <>
            <p className={`${ready.length > 0 ? "mt-4 " : ""}text-xs font-bold uppercase tracking-wide text-rc-faint`}>
              Used ({used.length})
            </p>
            <ul className="mt-2 space-y-1">
              {used.map((invite) => (
                <li key={invite.token} className="flex flex-wrap justify-between gap-2 text-xs text-rc-muted">
                  <span className="font-medium text-rc-ink">{invite.label}</span>
                  <span>{invite.agencyName ?? "agency not found"}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {dead.length > 0 && (
          <>
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-rc-faint">
              Cancelled or expired ({dead.length})
            </p>
            <ul className="mt-2 space-y-1">
              {dead.map((invite) => (
                <li key={invite.token} className="text-xs text-rc-muted">
                  {invite.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
