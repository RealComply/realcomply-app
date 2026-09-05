"use client";

import { useState, useTransition } from "react";
import { Link2, Copy, Check, X } from "lucide-react";
import { issueSignoffLink, revokeSignoffLink } from "@/lib/actions/signoff-links";
import { liveLink, signedLink, type SignoffLink } from "@/lib/data/signoff-links";
import { formatAuTimestamp } from "@/lib/format-date";

// The agent's half of licensee sign-off by link: create it, copy it, send it,
// and — since 5 Sep 2026 — get it back afterwards.
//
// WHAT CHANGED AND WHY. The link used to exist only in this component's state.
// Create it, and it was on screen; reload the page, and it was gone forever,
// with the button offering to create another one. That is fine in a demo and
// wrong in the week that actually matters: the agent sends the link on
// Tuesday, the licensee says on Thursday they cannot find the email, and the
// agent has nothing to re-send and no way to tell whether it was signed. The
// links are now read on the server and passed in, so the state of the request
// is a fact on the file rather than something that survived a page load.
//
// WHY THERE IS STILL NO "SEND EMAIL" BUTTON. SES is in the sandbox and rejects
// any recipient not verified in the AWS console — which every external
// licensee is, by definition. A send button would appear to work and deliver
// nothing to precisely the people this feature exists for. Copy-and-send-it-
// yourself works today, and is arguably the better default permanently: the
// link arrives from an agent the licensee knows rather than from software they
// have never heard of. When Resend is live, add the email button ALONGSIDE
// this, not instead of it.

export function SignoffLinkPanel({ propertyId, links }: { propertyId: string; links: SignoffLink[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const signed = signedLink(links);
  const live = liveLink(links);
  const expired = !signed && !live && links.length > 0;

  // Built here rather than server-side so the link always carries the origin
  // the agent is actually using, which matters on preview deployments and
  // would otherwise need the production URL hardcoded.
  const url = live && typeof window !== "undefined" ? `${window.location.origin}/signoff/${live.token}` : null;

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await issueSignoffLink(propertyId);
      if (result.error) setError(result.error);
      // No local state to set on success: the action revalidates this page and
      // the new link arrives as a prop.
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
        <div className="rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2">
          <p className="text-[11px] font-semibold text-rc-ink">Send this link to {live.sentTo}</p>
          {/* break-all so a long token wraps inside the card instead of
              forcing the whole item card wider on a phone. */}
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-rc-muted">
            {url ?? `/signoff/${live.token}`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
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
            Not signed yet. Sent {formatAuTimestamp(live.createdAt)}, expires{" "}
            {formatAuTimestamp(live.expiresAt)}. When they sign, this file updates on its own.
          </p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
          >
            <Link2 size={12} aria-hidden="true" />
            {pending ? "Creating…" : expired ? "Create a new link" : "Create sign-off link"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            {expired
              ? "The last link expired without being signed. A new one is good for another 30 days."
              : "Creates a link your licensee can open and sign without a RealComply login. Send it to them yourself for now."}
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
