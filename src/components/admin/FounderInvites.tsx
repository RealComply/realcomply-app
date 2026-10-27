"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Copy, Mail, X } from "lucide-react";
import {
  expireFounderInvite,
  previewPersonalInvite,
  sendPersonalInvite,
  type PersonalInvitePreview,
  type PersonalInviteState,
} from "@/lib/actions/founder-invites";

// Personal invites: people Adam invites himself, each with a link that sets
// up one new agency.
//
// Adam, 9 Sep 2026, having gone looking for this in Team settings and found
// only the invite that adds somebody to HIS agency: "that's only to invite
// people into my team. Which isn't what I want to do."
//
// Adam, 12 Oct 2026: "I would like anyone that I personally invite to ... have
// the same functionality as early access invites." So the site now emails the
// link, the same preview-then-send as the early access list, and the section
// is called Personal invites (it was Founder invites). Approved on the
// preview the same day.
//
// FREE ACCOUNT (Adam, 27 Oct 2026; 0098): a tick on a new invite, unticked
// by default. The office that link sets up is free from the start, with no
// card step. A "Free" pill marks those invites in the list.
//
// COPY LINK STAYS on every working invite, for when he would rather send it
// himself. A 32-character token half-selected with a mouse is a link that
// silently does not work, which is why it is a button.

export type FounderInvite = {
  token: string;
  label: string;
  email: string | null;
  firstName: string | null;
  /** "9 Oct", Sydney time. Null when the site has never emailed it. */
  sentLabel: string | null;
  acceptedAt: string | null;
  expiresAt: string;
  agencyName: string | null;
  expired: boolean;
  /** Sets up a free account, no card (0098). */
  free: boolean;
};

/** The "Free" pill beside a free account invite. A pill, never a circle. */
function FreePill() {
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-rc-green-soft px-2 py-0.5 align-middle text-[11px] font-semibold text-rc-green-deep">
      Free
    </span>
  );
}

const btn =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-60";
const btnPrimary = `${btn} bg-rc-green-deep text-white hover:bg-rc-green-deep-600`;
const btnQuiet = `${btn} border border-rc-border bg-white text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink`;
const input =
  "min-w-0 rounded-lg border border-rc-border px-3 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft";

export function FounderInvites({ invites, siteUrl }: { invites: FounderInvite[]; siteUrl: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const linkFor = (token: string) => `${siteUrl}/signup?founder=${token}`;

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000);
    } catch {
      // Clipboard access can be refused outright: an insecure context, or a
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

  function sent(notice: string) {
    setOpenToken(null);
    setToast(notice);
  }

  const ready = invites.filter((i) => !i.acceptedAt && !i.expired);
  const used = invites.filter((i) => i.acceptedAt);
  const dead = invites.filter((i) => !i.acceptedAt && i.expired);

  return (
    <div className="space-y-4">
      {toast && (
        <p role="status" className="inline-block rounded-full bg-rc-ink px-4 py-2 text-sm text-white">
          {toast}
        </p>
      )}

      {/* INVITE SOMEONE. At the top, because on this screen it is the thing
          being looked for. The list underneath is what you check afterwards. */}
      <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
        <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Invite someone</p>
        <p className="mt-1 text-xs text-rc-muted">
          One link, one new agency. They set up their own office and never see yours.
        </p>
        <Composer key={toast ?? "new"} withAgency onSent={sent} onCancel={null} />
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-rc-amber-deep">
          {error}
        </p>
      )}

      <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
        {invites.length === 0 && <p className="text-xs text-rc-muted">No invites yet. Send one above.</p>}

        {ready.length > 0 && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Waiting to be used ({ready.length})</p>
            <ul className="mt-2 space-y-2">
              {ready.map((invite) => (
                <li key={invite.token} className="rounded-lg border border-rc-border bg-rc-bg-alt px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-rc-ink">
                        {invite.label}
                        {invite.free && <FreePill />}
                        {invite.email && invite.email !== invite.label && (
                          <span className="ml-1.5 font-normal text-rc-muted">{invite.email}</span>
                        )}
                      </p>
                      <p className="mt-1">
                        {invite.sentLabel ? (
                          <span className="inline-flex rounded-full bg-[#fbf0dc] px-2 py-0.5 text-[11px] font-semibold text-[#a3610a]">
                            Emailed {invite.sentLabel}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-[#eef1f0] px-2 py-0.5 text-[11px] font-semibold text-[#3d5a52]">
                            Link only, not emailed
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenToken(invite.token);
                          setToast(null);
                        }}
                        disabled={openToken === invite.token}
                        className={invite.sentLabel ? btnQuiet : btnPrimary}
                      >
                        <Mail size={11} aria-hidden="true" />
                        {invite.sentLabel ? "Resend" : "Email it"}
                      </button>
                      <button type="button" onClick={() => copy(invite.token)} className={btnQuiet}>
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
                        className={btnQuiet}
                      >
                        <X size={11} aria-hidden="true" />
                        {cancelling === invite.token ? "…" : "Cancel"}
                      </button>
                    </div>
                  </div>
                  {openToken === invite.token && (
                    <div className="mt-2.5 border-t border-rc-border pt-2.5">
                      <p className="text-xs text-rc-muted">
                        {invite.sentLabel
                          ? "This sends a fresh link. The old one stops working."
                          : "This emails the same link, so if you've already sent it another way it still works."}
                      </p>
                      <Composer
                        token={invite.token}
                        initialFirstName={invite.firstName ?? ""}
                        initialEmail={invite.email ?? ""}
                        onSent={sent}
                        onCancel={() => setOpenToken(null)}
                      />
                    </div>
                  )}
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
                  <span className="font-medium text-rc-ink">
                    {invite.label}
                    {invite.free && <FreePill />}
                  </span>
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

/**
 * First name and email, then Preview, then Send. Used for a new invite, for
 * emailing a link made earlier, and for a resend. Nothing is sent until the
 * second click, the same as the early access list.
 */
function Composer({
  token,
  initialFirstName = "",
  initialEmail = "",
  withAgency = false,
  onSent,
  onCancel,
}: {
  token?: string;
  initialFirstName?: string;
  initialEmail?: string;
  withAgency?: boolean;
  onSent: (notice: string) => void;
  onCancel: (() => void) | null;
}) {
  const [firstName, setFirstName] = useState(initialFirstName);
  const [email, setEmail] = useState(initialEmail);
  const [agency, setAgency] = useState("");
  // Only on a new invite: a resend keeps whatever the invite already was.
  const [free, setFree] = useState(false);
  const [preview, setPreview] = useState<PersonalInvitePreview | null>(null);
  const [loading, startLoading] = useTransition();
  const [state, send, sending] = useActionState(sendPersonalInvite, { error: null } as PersonalInviteState);
  // Set on the first click and never cleared: the server refuses a second
  // send as well, this just means it is never asked.
  const [pressed, setPressed] = useState(false);
  const id = token ?? "new";

  useEffect(() => {
    if (state.notice) onSent(state.notice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.notice]);

  function showPreview() {
    startLoading(async () => {
      setPreview(await previewPersonalInvite({ firstName, email }));
    });
  }

  // Editing a field after previewing closes the preview, so what is sent is
  // always what was last shown.
  function edit(set: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      set(e.target.value);
      setPreview(null);
    };
  }

  const name = firstName.trim() || email.trim();

  return (
    <div className="mt-2.5">
      <div className={`grid gap-2 ${withAgency ? "sm:grid-cols-[1fr_1.4fr_1fr]" : "sm:grid-cols-[1fr_1.4fr]"}`}>
        <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-rc-muted" htmlFor={`fn-${id}`}>
          First name
          <input id={`fn-${id}`} value={firstName} onChange={edit(setFirstName)} maxLength={80} placeholder="Dave" className={input} />
        </label>
        <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-rc-muted" htmlFor={`em-${id}`}>
          Email
          <input
            id={`em-${id}`}
            type="email"
            value={email}
            onChange={edit(setEmail)}
            placeholder="dave@agency.com.au"
            className={input}
          />
        </label>
        {withAgency && (
          <label className="flex min-w-0 flex-col gap-0.5 text-[11px] text-rc-muted" htmlFor={`ag-${id}`}>
            Agency (for your list)
            <input id={`ag-${id}`} value={agency} onChange={edit(setAgency)} maxLength={120} placeholder="Ray White Hornsby" className={input} />
          </label>
        )}
      </div>
      {withAgency && (
        <p className="mt-2 text-xs text-rc-muted">
          <label className="mr-2 inline-flex items-center gap-2 font-semibold text-rc-ink" htmlFor={`free-${id}`}>
            <input
              id={`free-${id}`}
              type="checkbox"
              checked={free}
              onChange={(e) => {
                setFree(e.target.checked);
                setPreview(null);
              }}
              className="h-4 w-4 accent-rc-green-deep"
            />
            Free account (no card)
          </label>
          Their office is free from the start. No trial, no card.
        </p>
      )}

      {!preview && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={showPreview}
            disabled={loading || !email.trim()}
            className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-4 py-2 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {loading ? "Loading…" : "Preview email"}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="text-xs text-rc-muted">
              Cancel
            </button>
          )}
          <span className="text-[11px] text-rc-muted">Nothing is sent until you press Send.</span>
        </div>
      )}

      {preview && preview.error !== null && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-xs font-medium text-rc-amber-deep">
            {preview.error}
          </p>
          <button type="button" onClick={() => setPreview(null)} className="text-xs text-rc-muted underline">
            Change
          </button>
        </div>
      )}

      {preview && preview.error === null && (
        <div className="mt-3 flex flex-wrap items-start gap-4 rounded-xl border border-rc-green-deep/40 bg-[#f8fbf9] p-3">
          <div className="min-w-0 flex-[1_1_360px] overflow-hidden rounded-xl border border-rc-border bg-white">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-b border-rc-border px-3.5 py-2.5 text-[13px] text-rc-muted">
              <dt>To</dt>
              <dd className="break-all font-semibold text-rc-ink">{preview.to}</dd>
              <dt>BCC</dt>
              <dd className="text-rc-ink">{preview.bcc}</dd>
              <dt>From</dt>
              <dd className="text-rc-ink">{preview.from}</dd>
              <dt>Subject</dt>
              <dd className="font-semibold text-rc-ink">{preview.subject}</dd>
              {free && (
                <>
                  <dt>Account</dt>
                  <dd className="font-semibold text-rc-green-deep">Free, no card</dd>
                </>
              )}
            </dl>
            {/* The real HTML, sandboxed: no scripts, and its links go nowhere. */}
            <iframe
              title={`Invitation email to ${preview.to}`}
              srcDoc={preview.html}
              sandbox=""
              className="block h-[480px] w-full border-0"
            />
          </div>
          <div className="flex flex-[0_1_240px] flex-col gap-2.5 text-sm text-[#3d5a52]">
            <form
              action={send}
              onSubmit={(e) => {
                if (pressed) e.preventDefault();
                else setPressed(true);
              }}
              className="flex flex-wrap gap-2"
            >
              {token && <input type="hidden" name="token" value={token} />}
              <input type="hidden" name="firstName" value={firstName} />
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="label" value={agency} />
              {free && <input type="hidden" name="freeAccount" value="yes" />}
              <button
                type="submit"
                disabled={pressed || sending}
                className="rounded-full border-[1.5px] border-[#0b7d50] bg-[#0b7d50] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {sending ? "Sending…" : `Send to ${name}`}
              </button>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={sending}
                className="rounded-full border-[1.5px] border-rc-border bg-white px-4 py-2 text-sm font-bold text-[#3d5a52]"
              >
                Back
              </button>
            </form>
            {state.error && (
              <p role="alert" className="break-all text-[12px] font-medium text-rc-amber-deep">
                {state.error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
