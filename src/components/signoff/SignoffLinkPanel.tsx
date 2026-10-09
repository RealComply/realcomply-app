"use client";

import { useState, useTransition } from "react";
import { Send, X, RotateCw, AlertTriangle } from "lucide-react";
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
// REVERSAL (Adam, 9 Oct 2026). Was: "the copy path stays, as a second
// option… never remove the manual route." Now the link is never shown here
// and there is no Copy button: an agent holding the link could open it and
// sign as the licensee. It goes only by email, to the agency's licensee
// email; if a send fails, Send again.
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
  const [justSent, setJustSent] = useState(false);

  const signed = signedLink(links);
  const live = liveLink(links);
  const expired = !signed && !live && links.length > 0;

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
        setError("The link was created but the email couldn't be sent. Press Send again in a moment.");
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
                The link is still valid. Send it again; it only ever goes to the licensee&rsquo;s email.
              </p>
            </>
          ) : (
            <p className="text-[11px] font-semibold text-rc-ink">
              Sent to {live.sentTo} on {formatAuTimestamp(live.emailSentAt ?? live.createdAt)}
            </p>
          )}

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
