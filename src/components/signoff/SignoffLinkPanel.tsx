"use client";

import { useState, useTransition } from "react";
import { Send, X, RotateCw, AlertTriangle, Copy, Check } from "lucide-react";
import { issueSignoffLink, resendSignoffLink, revokeSignoffLink } from "@/lib/actions/signoff-links";
import { copySignoffLink } from "@/lib/actions/link-delivery";
import { linksFor, liveLink, signedLink, type SignoffLink } from "@/lib/data/signoff-links";
import { formatAuTimestamp } from "@/lib/format-date";
import {
  copiedLinkLine,
  copiesBeforeSigning,
  copyLinkHint,
  nudgeText,
  openedLine,
  unopenedNudgeDue,
} from "@/lib/links/delivery";

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
// CHANGE (Adam, 3 Nov 2026, queue item 2, option 2; 0107).
// WAS (9 Oct 2026): no Copy button, and the link never shown here, because an
//   agent holding it could open it and sign as the licensee.
// NOW: Copy link is back, with a trail. Each copy is recorded (who, when);
//   a signature given after a copy says so here and on the record; and the
//   signing page asks the signer to confirm they are the licensee in charge,
//   signing for themselves. The card also says "Opened [date, time]" once a
//   person opens the link in a browser, and after 2 NSW business days
//   unopened it nudges: copy it and send it yourself, or ask them to check
//   their spam or junk folder (Adam, 3 Nov 2026: was "quarantine", a word no
//   one uses).
// WHY: Vic Srbinovski's approval email of 21 Oct was most likely held by his
//   office's email security. An office must never need IT to let RealComply
//   through, and must never rely on email alone.
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
  const [copied, setCopied] = useState(false);

  // The final sign-off's links only. The page passes only those; this keeps
  // a price statement request (b4, 0066) from ever reading as the signature.
  const signed = signedLink(links, "sign_licensee");
  const live = liveLink(links, "sign_licensee");
  const expired = !signed && !live && linksFor(links, "sign_licensee").length > 0;

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

  function copy(id: string) {
    setError(null);
    setCopied(false);
    // The database records the copy, then hands the link back.
    const asked = copySignoffLink(id, propertyId);
    // Safari writes to the clipboard only from inside the click, so the write
    // starts now and is handed the link when it arrives.
    let wrote: Promise<void> | null = null;
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const blob = asked.then((r) => {
          if (!r.url) throw new Error(r.error ?? "no link");
          return new Blob([r.url], { type: "text/plain" });
        });
        wrote = navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
        wrote.catch(() => {});
      }
    } catch {
      wrote = null;
    }
    startTransition(async () => {
      const result = await asked;
      if (!result.url) {
        setError(result.error ?? "Couldn't copy the link just now. Try again.");
        return;
      }
      try {
        if (wrote) await wrote;
        else await navigator.clipboard.writeText(result.url);
        setCopied(true);
      } catch {
        try {
          await navigator.clipboard.writeText(result.url);
          setCopied(true);
        } catch {
          // A browser that won't write to the clipboard: show the link to copy by hand.
          setError(`Copy this link: ${result.url}`);
        }
      }
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
          {copiesBeforeSigning(signed.copies, signed.signedAt).slice(0, 1).map((c) => (
            <p key={c.at} className="mt-1 text-[11px] leading-relaxed text-rc-ink">
              {copiedLinkLine(c)}
            </p>
          ))}
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
            <>
              <p className="text-[11px] font-semibold text-rc-ink">
                Sent to {live.sentTo} on {formatAuTimestamp(live.emailSentAt ?? live.createdAt)}
              </p>
              {openedLine(delivery(live)) && (
                <p className="mt-0.5 text-[11px] text-rc-muted">{openedLine(delivery(live))}</p>
              )}
              {unopenedNudgeDue(delivery(live)) && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed text-rc-amber-deep">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  {nudgeText("signoff", live.licenseeName)}
                </p>
              )}
            </>
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
            <button
              type="button"
              onClick={() => copy(live.id)}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/30 disabled:opacity-60"
            >
              {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            {copyLinkHint(live.licenseeName)} Copying it is recorded on the file.
          </p>

          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            Not signed yet. Expires {formatAuTimestamp(live.expiresAt)}. When they sign, this file updates on
            its own. Replies to that email go to whoever sent it, not to RealComply.
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
              : "Emails your licensee in charge a link to review the file and sign it, or send it back for changes. No RealComply login needed. Their reply comes to you."}
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

/** The link as lib/links/delivery.ts reads it. */
function delivery(link: SignoffLink) {
  return { emailSentAt: link.emailSentAt, createdAt: link.createdAt, openedAt: link.openedAt, doneAt: link.signedAt };
}
