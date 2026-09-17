"use client";

import { useState, useTransition } from "react";
import { Send, Copy, Check, X, RotateCw, AlertTriangle } from "lucide-react";
import { issueSignoffLink, resendSignoffLink, revokeSignoffLink } from "@/lib/actions/signoff-links";
import { liveLink, signedLink, type SignoffLink } from "@/lib/data/signoff-links";
import { formatAuTimestamp } from "@/lib/format-date";

// The agent's half of licensee sign-off by link.
//
// WHAT CHANGED, 5 SEP 2026. The link used to exist only in this component's
// state. Create it, and it was on screen; reload the page, and it was gone
// forever, with the button offering to create another one. That is fine in a
// demo and wrong in the week that actually matters: the agent sends the link
// on Tuesday, the licensee says on Thursday they cannot find the email, and
// the agent has nothing to re-send and no way to tell whether it was signed.
// The links are now read on the server and passed in, so the state of the
// request is a fact on the file rather than something that survived a page
// load.
//
// WHAT CHANGED, 17 SEP 2026 — IT SENDS THE EMAIL NOW.
//
// The old comment here said there was no send button because SES was
// sandboxed and would reject any recipient not verified in the AWS console.
// That was true when it was written and had stopped being true three weeks
// earlier: SES was granted production access on 26 August. The note was
// written on 5 September and inherited the dead constraint, so agents went on
// copying links into their own email for no reason.
//
// Adam, 17 Sep 2026: "it should get automatically sent to the licensee so that
// the agent doesn't have to create a link, copy it, open their email, paste it
// in, send it with an explanation. We should do all that for them."
//
// THE COPY PATH STAYS, as a second option. Some agents will want to send it
// themselves with their own note, and a link arriving from a person the
// licensee knows is likelier to be opened than one from software they have
// never heard of. Default to automatic; never remove the manual route.
//
// SENT IS A FACT, NOT AN ASSUMPTION. This panel says "Sent to X on <date>"
// only when the email actually reached the provider — email_sent_at in 0047.
// A send that failed says so, in amber, with the link still copyable. The
// alternative is an agent waiting a fortnight for a signature on a message
// that never left the building, which is the same fault as a backup panel
// reading "Nothing outstanding" over an empty bucket.

export function SignoffLinkPanel({ propertyId, links }: { propertyId: string; links: SignoffLink[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [justSent, setJustSent] = useState(false);

  const signed = signedLink(links);
  const live = liveLink(links);
  const expired = !signed && !live && links.length > 0;

  // Built here rather than server-side so the link always carries the origin
  // the agent is actually using, which matters on preview deployments. The
  // EMAIL uses NEXT_PUBLIC_SITE_URL instead, because a server action has no
  // window to read.
  const url = live && typeof window !== "undefined" ? `${window.location.origin}/signoff/${live.token}` : null;

  // Attempted and not delivered. Distinct from "not attempted", which only
  // happens on rows created before 0047.
  const sendFailed = live !== null && live.emailSentAt === null && live.emailAttempts > 0;

  function send() {
    setError(null);
    setJustSent(false);
    startTransition(async () => {
      const result = await issueSignoffLink(propertyId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.emailed === false) {
        setError("The link was created but the email couldn't be sent. Copy it and send it yourself.");
        return;
      }
      setJustSent(true);
    });
  }

  function resend() {
    setError(null);
    setJustSent(false);
    startTransition(async () => {
      const result = await resendSignoffLink(propertyId);
      if (result.error) setError(result.error);
      else setJustSent(true);
    });
  }

  function withdraw(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeSignoffLink(id, propertyId);
      if (result.error) setError(result.error);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it manually.");
    }
  }

  return (
    <div className="mt-1">
      {signed ? (
        <div className="rounded-md border border-rc-green-deep/25 bg-rc-green-soft px-2.5 py-2">
          <p className="text-[11px] font-semibold text-rc-green-deep">
            Signed by {signed.signedName} on {formatAuTimestamp(signed.signedAt)}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
            The licensee signature is on the file, and the link has closed.
          </p>
        </div>
      ) : live ? (
        <div
          className={`rounded-md border px-2.5 py-2 ${
            sendFailed ? "border-rc-amber/50 bg-rc-amber/10" : "border-rc-border bg-rc-bg-alt"
          }`}
        >
          {sendFailed ? (
            <>
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-rc-amber-deep">
                <AlertTriangle size={12} aria-hidden="true" />
                Couldn&rsquo;t email {live.sentTo}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-rc-muted">
                The link below is valid — copy it and send it to them yourself, or try sending again.
              </p>
            </>
          ) : (
            <p className="text-[11px] font-semibold text-rc-ink">
              Sent to {live.sentTo} on {formatAuTimestamp(live.emailSentAt ?? live.createdAt)}
            </p>
          )}

          {/* break-all so a long token wraps inside the card instead of
              forcing the whole item card wider on a phone. */}
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-rc-muted">
            {url ?? `/signoff/${live.token}`}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resend}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              <RotateCw size={12} aria-hidden="true" />
              {pending ? "Sending…" : justSent ? "Sent again" : "Send again"}
            </button>
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20"
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <button
              type="button"
              onClick={() => withdraw(live.id)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:text-rc-ink disabled:opacity-60"
            >
              <X size={12} aria-hidden="true" />
              Withdraw
            </button>
          </div>

          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            Not signed yet. Expires {formatAuTimestamp(live.expiresAt)}. When they sign, this file updates on
            its own. Replies to that email go to you, not to RealComply.
          </p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={send}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            <Send size={12} aria-hidden="true" />
            {pending ? "Sending…" : expired ? "Send a new link" : "Send sign-off link"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            {expired
              ? "The last link expired without being signed. A new one is good for another 30 days."
              : "Emails your licensee in charge a link they can open and sign without a RealComply login. Their reply comes to you."}
          </p>
        </>
      )}
      {error && (
        <p className="mt-1.5 text-[11px] font-medium text-rc-amber-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
