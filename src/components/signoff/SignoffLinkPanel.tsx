"use client";

import { useState, useTransition } from "react";
import { Link2, Copy, Check } from "lucide-react";
import { issueSignoffLink } from "@/lib/actions/signoff-links";

// The agent's half of licensee sign-off by link: create it, copy it, send it.
//
// WHY THERE IS NO "SEND EMAIL" BUTTON HERE YET. SES is still in the sandbox
// and rejects any recipient not verified in the AWS console — which every
// external licensee is, by definition. A send button would appear to work and
// silently deliver nothing to precisely the people this feature exists for.
// Copy-and-send-it-yourself works today, and is arguably the better default
// permanently: the link arrives from an agent the licensee knows rather than
// from software they have never heard of. When Resend is live, add the email
// button ALONGSIDE this, not instead of it.

export function SignoffLinkPanel({ propertyId }: { propertyId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await issueSignoffLink(propertyId);
      if (result.error || !result.token) {
        setError(result.error ?? "Couldn't create the link.");
        return;
      }
      // Built here rather than server-side so the link always carries the
      // origin the agent is actually using, which matters on preview
      // deployments and would otherwise need the production URL hardcoded.
      setUrl(`${window.location.origin}/signoff/${result.token}`);
      setSentTo(result.sentTo ?? null);
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
      {!url ? (
        <>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20 disabled:opacity-60"
          >
            <Link2 size={12} aria-hidden="true" />
            {pending ? "Creating…" : "Create sign-off link"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            Creates a link your licensee can open and sign without a RealComply login. Send it to them yourself
            for now.
          </p>
        </>
      ) : (
        <div className="rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2">
          <p className="text-[11px] font-semibold text-rc-ink">
            Send this link to {sentTo ?? "your licensee"}
          </p>
          {/* break-all so a long token wraps inside the card instead of
              forcing the whole item card wider on a phone. */}
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-rc-muted">{url}</p>
          <button
            type="button"
            onClick={copy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
          >
            {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-rc-muted">
            Valid for 30 days, and once. When they sign, this file updates on its own.
          </p>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-[11px] font-medium text-rc-amber-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
