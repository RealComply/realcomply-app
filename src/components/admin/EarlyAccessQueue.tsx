"use client";

import { Fragment, useActionState, useEffect, useState, useTransition } from "react";
import {
  declineEarlyAccess,
  previewEarlyAccessInvite,
  sendEarlyAccessInvite,
  type DecisionState,
  type InvitePreview,
  type SendState,
} from "@/lib/actions/early-access-decisions";
import { earlyAccessStatus, type EarlyAccessStatus } from "@/lib/early-access/rules";

// The early access list, on the staff page. Rebuilt 10 Oct 2026 to the early
// access invites brief and its approved mockup.
//
// One row per registrant, newest first, with filter tabs that count each
// group. Send invite (or Resend) opens the email exactly as it will go, and
// nothing is sent until the second click. Decline stays, as a quiet link on
// rows not yet invited (Adam, 10 Oct 2026), because without it nobody could
// ever be moved to "Declined" from the screen.
//
// AFTER A SEND the row is moved here, in state, so the counts and the list
// change straight away without a reload (brief: "Counts and the list update
// straight after a send").

export type EarlyAccessRow = {
  id: string;
  email: string;
  firstName: string | null;
  agencyName: string | null;
  /** "4 Oct 2026", already in Sydney time. */
  registered: string;
  invitedAt: string | null;
  /** "9 Oct", Sydney time. */
  invitedLabel: string | null;
  unsubscribedAt: string | null;
  declinedAt: string | null;
  declinedNote: string | null;
  signedUpAt: string | null;
  signedUpLabel: string | null;
  welcomeSent: boolean;
};

type Filter = "all" | EarlyAccessStatus;

const TABS: { key: Filter; label: string; tone: string }[] = [
  { key: "all", label: "All", tone: "bg-white text-rc-muted" },
  { key: "not_invited", label: "Not invited", tone: "bg-[#eef1f0] text-[#3d5a52]" },
  { key: "invited", label: "Invited", tone: "bg-[#fbf0dc] text-[#a3610a]" },
  { key: "signed_up", label: "Signed up", tone: "bg-[#e3f4ec] text-[#0b7d50]" },
  { key: "unsubscribed", label: "Unsubscribed", tone: "bg-[#f6e7e7] text-[#8a2c2c]" },
];

const statusOf = (r: EarlyAccessRow) => earlyAccessStatus(r);

const pill = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold";

function sydneyShort(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" }).format(
    new Date(iso),
  );
}

export function EarlyAccessQueue({ rows: initialRows }: { rows: EarlyAccessRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const counts: Record<Filter, number> = {
    all: rows.length,
    not_invited: 0,
    invited: 0,
    signed_up: 0,
    unsubscribed: 0,
  };
  for (const r of rows) counts[statusOf(r)]++;

  const shown = rows.filter((r) => filter === "all" || statusOf(r) === filter);

  function markSent(id: string, invitedAt: string) {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, invitedAt, invitedLabel: sydneyShort(invitedAt) } : r)),
    );
  }

  function markDeclined(id: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, declinedAt: new Date().toISOString() } : r)));
  }

  return (
    <div className="space-y-3">
      {toast && (
        <p role="status" className="inline-block rounded-full bg-rc-ink px-4 py-2 text-sm text-white">
          {toast}
        </p>
      )}

      <section className="overflow-hidden rounded-[18px] border border-rc-border bg-white shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rc-border px-5 py-4">
          <h3 className="text-base font-bold text-rc-ink">Registrants</h3>
          <div role="group" aria-label="Show registrants by status" className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={filter === t.key}
                onClick={() => {
                  setFilter(t.key);
                  setOpenId(null);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold ${t.tone} ${
                  filter === t.key ? "border-rc-ink shadow-[inset_0_0_0_1px_var(--color-rc-ink,#16302a)]" : "border-rc-border"
                }`}
              >
                {t.label} <b className="tabular-nums">{counts[t.key]}</b>
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="text-left text-[12px] font-bold uppercase tracking-[0.06em] text-rc-muted">
                <th scope="col" className="px-5 py-2.5">Name</th>
                <th scope="col" className="px-5 py-2.5">Email</th>
                <th scope="col" className="whitespace-nowrap px-5 py-2.5">Registered</th>
                <th scope="col" className="px-5 py-2.5">Status</th>
                <th scope="col" className="px-5 py-2.5"><span className="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="border-t border-rc-border px-5 py-7 text-center text-sm text-rc-muted">
                    Nobody in this group.
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <Row
                    row={r}
                    open={openId === r.id}
                    onOpen={() => {
                      setOpenId(r.id);
                      setToast(null);
                    }}
                    onDeclined={() => markDeclined(r.id)}
                  />
                  {openId === r.id && (
                    <ConfirmRow
                      row={r}
                      onCancel={() => setOpenId(null)}
                      onSent={(invitedAt, notice) => {
                        markSent(r.id, invitedAt);
                        setOpenId(null);
                        setToast(notice);
                      }}
                      onMadeButNotSent={(invitedAt) => markSent(r.id, invitedAt)}
                    />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="max-w-[70ch] text-[13px] text-rc-muted">
        When someone signs up with their invitation, their row shows &ldquo;Signed up&rdquo;. Once they have put
        their card in and started their trial, the welcome email with the licensee video goes automatically, also
        BCC&rsquo;d to admin@realcomply.com.au (when it is switched on). Your own test addresses at realcomply.com.au and cassproperty.com.au are left off this list.
      </p>
    </div>
  );
}

function StatusPill({ row }: { row: EarlyAccessRow }) {
  switch (statusOf(row)) {
    case "signed_up":
      return (
        <span className={`${pill} bg-[#e3f4ec] text-[#0b7d50]`}>
          Signed up {row.signedUpLabel}
          {row.welcomeSent ? " · welcome sent" : ""}
        </span>
      );
    case "unsubscribed":
      return (
        <span className={`${pill} bg-[#f6e7e7] text-[#8a2c2c]`} title={row.declinedNote ?? undefined}>
          {row.unsubscribedAt ? "Unsubscribed" : "Declined"}
        </span>
      );
    case "invited":
      return <span className={`${pill} bg-[#fbf0dc] text-[#a3610a]`}>Invited {row.invitedLabel}</span>;
    default:
      return <span className={`${pill} bg-[#eef1f0] text-[#3d5a52]`}>Not invited</span>;
  }
}

function Row({
  row,
  open,
  onOpen,
  onDeclined,
}: {
  row: EarlyAccessRow;
  open: boolean;
  onOpen: () => void;
  onDeclined: () => void;
}) {
  const status = statusOf(row);
  const [declining, setDeclining] = useState(false);
  const [declineState, decline, declinePending] = useActionState(declineEarlyAccess, {
    error: null,
  } as DecisionState);

  useEffect(() => {
    if (declineState.notice) onDeclined();
    // onDeclined is a fresh closure each render; the notice is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declineState.notice]);

  return (
    <tr className="border-t border-rc-border align-middle text-sm">
      <td className="px-5 py-3.5 text-rc-ink">
        {row.firstName || "(no name)"}
        <small className="block text-[13px] text-rc-muted">{row.agencyName || "No agency given"}</small>
      </td>
      <td className="px-5 py-3.5 text-rc-ink">{row.email}</td>
      <td className="whitespace-nowrap px-5 py-3.5 tabular-nums text-rc-ink">{row.registered}</td>
      <td className="px-5 py-3.5">
        <StatusPill row={row} />
      </td>
      <td className="px-5 py-3.5">
        {status === "unsubscribed" && <small className="text-[13px] text-rc-muted">Can&rsquo;t be emailed</small>}

        {status === "invited" && (
          <button
            type="button"
            onClick={onOpen}
            disabled={open}
            className="rounded-full border-[1.5px] border-rc-border bg-white px-4 py-2 text-sm font-bold text-[#3d5a52] disabled:opacity-60"
          >
            Resend
          </button>
        )}

        {status === "not_invited" && !declining && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpen}
              disabled={open}
              className="whitespace-nowrap rounded-full border-[1.5px] border-[#0b7d50] bg-white px-4 py-2 text-sm font-bold text-[#0b7d50] disabled:opacity-60"
            >
              Send invite
            </button>
            <button
              type="button"
              onClick={() => setDeclining(true)}
              className="text-[13px] font-medium text-rc-muted underline-offset-2 hover:text-rc-ink hover:underline"
            >
              Decline
            </button>
          </div>
        )}

        {status === "not_invited" && declining && (
          <form action={decline} className="min-w-[220px]">
            <input type="hidden" name="id" value={row.id} />
            <label className="block text-[11px] font-medium text-rc-muted" htmlFor={`note-${row.id}`}>
              Why? Only you see this. Nothing is sent to them.
            </label>
            <input
              id={`note-${row.id}`}
              name="note"
              maxLength={300}
              required
              className="mt-1 w-full rounded-md border border-rc-border px-2.5 py-1.5 text-xs text-rc-ink"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="submit"
                disabled={declinePending}
                className="rounded-full border border-rc-border bg-white px-3 py-1 text-xs font-semibold text-rc-ink disabled:opacity-60"
              >
                {declinePending ? "Saving…" : "Record decline"}
              </button>
              <button type="button" onClick={() => setDeclining(false)} className="text-xs text-rc-muted">
                Cancel
              </button>
            </div>
            {declineState.error && (
              <p role="alert" className="mt-1 text-[11px] font-medium text-rc-amber-deep">
                {declineState.error}
              </p>
            )}
          </form>
        )}
      </td>
    </tr>
  );
}

function ConfirmRow({
  row,
  onCancel,
  onSent,
  onMadeButNotSent,
}: {
  row: EarlyAccessRow;
  onCancel: () => void;
  onSent: (invitedAt: string, notice: string) => void;
  /** The link was made but the email failed: the row is Invited, and the panel stays open with the link. */
  onMadeButNotSent: (invitedAt: string) => void;
}) {
  const resend = statusOf(row) === "invited";
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, send, sending] = useActionState(sendEarlyAccessInvite, { error: null } as SendState);
  // Set on the first click and never cleared: the button cannot be pressed
  // twice even before React has re-rendered with `sending`. The server refuses
  // a second send on its own as well; this just means it is never asked.
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    startLoading(async () => {
      setPreview(await previewEarlyAccessInvite(row.id));
    });
  }, [row.id]);

  useEffect(() => {
    if (!state.sent) return;
    if (!state.error && state.notice) onSent(state.sent.invitedAt, state.notice);
    else onMadeButNotSent(state.sent.invitedAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const name = preview && preview.error === null ? preview.firstName ?? row.email : row.firstName ?? row.email;

  return (
    <tr>
      <td colSpan={5} className="bg-[#f8fbf9] p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[1_1_360px] overflow-hidden rounded-xl border border-rc-border bg-white">
            {loading || !preview ? (
              <p className="p-4 text-sm text-rc-muted">Loading the email…</p>
            ) : preview.error !== null ? (
              <p role="alert" className="p-4 text-sm font-medium text-rc-amber-deep">
                {preview.error}
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-rc-border px-3.5 py-2.5 text-[13px] text-rc-muted">
                  <dt>To</dt>
                  <dd className="font-semibold text-rc-ink">{preview.to}</dd>
                  <dt>BCC</dt>
                  <dd className="text-rc-ink">{preview.bcc}</dd>
                  <dt>From</dt>
                  <dd className="text-rc-ink">{preview.from}</dd>
                  <dt>Subject</dt>
                  <dd className="font-semibold text-rc-ink">{preview.subject}</dd>
                </dl>
                {/* The real HTML, sandboxed: no scripts, and its links go nowhere. */}
                <iframe
                  title={`Invitation email to ${preview.to}`}
                  srcDoc={preview.html}
                  sandbox=""
                  className="block h-[520px] w-full border-0"
                />
              </>
            )}
          </div>

          <div className="flex flex-[0_1_260px] flex-col gap-2.5 text-sm text-[#3d5a52]">
            <p>
              {resend
                ? "This sends a fresh link. The old one stops working."
                : `A new sign-up link is made for ${name} when you press Send.`}
            </p>
            <form
              action={send}
              onSubmit={(e) => {
                if (pressed) e.preventDefault();
                else setPressed(true);
              }}
              className="flex flex-wrap gap-2"
            >
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="seenInvitedAt" value={row.invitedAt ?? ""} />
              <button
                type="submit"
                disabled={pressed || sending || !preview || preview.error !== null}
                className="rounded-full border-[1.5px] border-[#0b7d50] bg-[#0b7d50] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {sending ? "Sending…" : `Send to ${name}`}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={sending}
                className="rounded-full border-[1.5px] border-rc-border bg-white px-4 py-2 text-sm font-bold text-[#3d5a52]"
              >
                Cancel
              </button>
            </form>
            {state.error && (
              <p role="alert" className="break-all text-[12px] font-medium text-rc-amber-deep">
                {state.error}
              </p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
