"use client";

import { useActionState, useState } from "react";
import { Mail, Check, X, Copy, Clock, Ban } from "lucide-react";
import { inviteFromEarlyAccess, declineEarlyAccess, type DecisionState } from "@/lib/actions/early-access-decisions";
import { formatAuDate } from "@/lib/format-date";

// The early-access queue, on the staff page.
//
// Adam, 18 Sep 2026: "I want to know what it looks like once we are ready and
// live to accept invitations... so I can either deny or accept anyone that's
// registered for early access."
//
// THREE SECTIONS, AND THE ORDER IS THE POINT. Waiting first, because it is the
// only one that needs anything doing. Invited second, because the useful
// question about that group is who has not yet signed up — an invitation sent
// three weeks ago and never used is a nudge worth making, and it is invisible
// unless the screen separates "invited" from "invited and arrived".
//
// Declined last, collapsed, and kept rather than hidden — the whole reason 0049
// records a decline instead of removing the row is so the same name arriving
// again is recognised. A list you cannot see does not do that.
//
// DECLINE ASKS FOR A REASON and will not proceed without one. That is friction
// on purpose: the reason is the entire value of the record, and a decline with
// an empty note is the same as no record at all three months later.

export type EarlyAccessRow = {
  id: string;
  email: string;
  firstName: string | null;
  agencyName: string | null;
  source: string | null;
  createdAt: string;
  invitedAt: string | null;
  invitedToken: string | null;
  declinedAt: string | null;
  declinedNote: string | null;
  /** True once their invite has been used to create an agency. */
  signedUp: boolean;
};

const initial: DecisionState = { error: null };

export function EarlyAccessQueue({ rows, siteUrl }: { rows: EarlyAccessRow[]; siteUrl: string }) {
  const waiting = rows.filter((r) => !r.invitedAt && !r.declinedAt);
  const invited = rows.filter((r) => r.invitedAt);
  const declined = rows.filter((r) => r.declinedAt && !r.invitedAt);

  const [showDeclined, setShowDeclined] = useState(false);

  return (
    <div className="space-y-5">
      <section>
        <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">
          Waiting on you · {waiting.length}
        </p>
        {waiting.length === 0 ? (
          <p className="mt-2 text-xs text-rc-muted">
            Nobody waiting. New registrations from the landing page appear here.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {waiting.map((row) => (
              <WaitingCard key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      {invited.length > 0 && (
        <section>
          <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">
            Invited · {invited.length}
          </p>
          <ul className="mt-2 space-y-2">
            {invited.map((row) => (
              <InvitedCard key={row.id} row={row} siteUrl={siteUrl} />
            ))}
          </ul>
        </section>
      )}

      {declined.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowDeclined((v) => !v)}
            className="text-xs font-bold uppercase tracking-wide text-rc-faint transition hover:text-rc-muted"
          >
            Declined · {declined.length} {showDeclined ? "▾" : "▸"}
          </button>
          {showDeclined && (
            <ul className="mt-2 space-y-2">
              {declined.map((row) => (
                <li
                  key={row.id}
                  className="rounded-card border border-rc-border bg-rc-bg-alt px-3 py-2.5"
                >
                  <p className="text-sm text-rc-muted">
                    <Ban size={12} className="mr-1 inline" aria-hidden="true" />
                    {row.firstName ? `${row.firstName} — ` : ""}
                    {row.agencyName ?? row.email}
                  </p>
                  <p className="mt-0.5 text-[11px] text-rc-faint">{row.email}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
                    {formatAuDate((row.declinedAt ?? "").slice(0, 10))} — {row.declinedNote}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Who({ row }: { row: EarlyAccessRow }) {
  return (
    <>
      <p className="text-sm font-bold text-rc-ink">
        {row.agencyName ?? "(no agency given)"}
      </p>
      <p className="mt-0.5 text-xs text-rc-muted">
        {row.firstName ? `${row.firstName} · ` : ""}
        {row.email}
      </p>
      <p className="mt-0.5 text-[11px] text-rc-faint">
        Registered {formatAuDate(row.createdAt.slice(0, 10))}
        {row.source ? ` · via ${row.source}` : ""}
      </p>
    </>
  );
}

function WaitingCard({ row }: { row: EarlyAccessRow }) {
  const [inviteState, invite, invitePending] = useActionState(inviteFromEarlyAccess, initial);
  const [declineState, decline, declinePending] = useActionState(declineEarlyAccess, initial);
  const [declining, setDeclining] = useState(false);

  return (
    <li className="rounded-card border border-rc-border bg-white px-3 py-2.5 shadow-card">
      <Who row={row} />

      {!declining ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={invite}>
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              disabled={invitePending}
              className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              <Mail size={12} aria-hidden="true" />
              {invitePending ? "Sending…" : "Send invitation"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:text-rc-ink"
          >
            <X size={12} aria-hidden="true" />
            Decline
          </button>
        </div>
      ) : (
        <form action={decline} className="mt-2">
          <input type="hidden" name="id" value={row.id} />
          <label className="block text-[11px] font-medium text-rc-muted" htmlFor={`note-${row.id}`}>
            Why? Only you will ever see this — nothing is sent to them.
          </label>
          <input
            id={`note-${row.id}`}
            name="note"
            maxLength={300}
            required
            placeholder="e.g. competitor — training company that sells compliance forms"
            className="mt-1 w-full rounded-md border border-rc-border px-2.5 py-1.5 text-xs text-rc-ink placeholder:text-rc-faint"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="submit"
              disabled={declinePending}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
            >
              <Check size={12} aria-hidden="true" />
              {declinePending ? "Saving…" : "Record decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="text-xs font-medium text-rc-muted transition hover:text-rc-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {inviteState.error && (
        <p role="alert" className="mt-1.5 break-all text-[11px] font-medium text-rc-amber-deep">
          {inviteState.error}
        </p>
      )}
      {inviteState.notice && (
        <p className="mt-1.5 text-[11px] font-medium text-rc-green-deep">{inviteState.notice}</p>
      )}
      {declineState.error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {declineState.error}
        </p>
      )}
    </li>
  );
}

function InvitedCard({ row, siteUrl }: { row: EarlyAccessRow; siteUrl: string }) {
  const [state, invite, pending] = useActionState(inviteFromEarlyAccess, initial);
  const [copied, setCopied] = useState(false);
  const url = row.invitedToken ? `${siteUrl}/signup?founder=${row.invitedToken}` : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the link is on screen; copying is a convenience, not the mechanism */
    }
  }

  return (
    <li
      className={`rounded-card border px-3 py-2.5 ${
        row.signedUp ? "border-rc-green-deep/25 bg-rc-green-soft" : "border-rc-border bg-white shadow-card"
      }`}
    >
      <Who row={row} />

      {row.signedUp ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-rc-green-deep">
          <Check size={12} aria-hidden="true" />
          Signed up and set their agency up
        </p>
      ) : (
        <>
          {/* The number that matters on this card: how long the invitation has
              been sitting unused. An invite sent three weeks ago and never
              opened is a phone call, and it is invisible without this line. */}
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-rc-amber-deep">
            <Clock size={12} aria-hidden="true" />
            Invited {formatAuDate((row.invitedAt ?? "").slice(0, 10))} — not signed up yet
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <form action={invite}>
              <input type="hidden" name="id" value={row.id} />
              <button
                type="submit"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
              >
                <Mail size={12} aria-hidden="true" />
                {pending ? "Sending…" : "Send again"}
              </button>
            </form>
            {url && (
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:text-rc-ink"
              >
                {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                {copied ? "Copied" : "Copy link"}
              </button>
            )}
          </div>
        </>
      )}

      {state.error && (
        <p role="alert" className="mt-1.5 break-all text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
      {state.notice && <p className="mt-1.5 text-[11px] font-medium text-rc-green-deep">{state.notice}</p>}
    </li>
  );
}
