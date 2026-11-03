"use client";

import { useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { copyLicenseeLink, resendPack } from "@/lib/actions/licensee-signoff";
import { copyLinkHint } from "@/lib/links/delivery";

// Where the pack's email is up to, for the office (the email job's rules,
// 2 Nov 2026): Sent, then Opened only when a person opens it, the nudge
// after 2 business days unopened, Copy link (recorded) and Send again.
export function PackLinkStatus({
  linkId,
  licenseeName,
  sentLine,
  openedLine,
  nudge,
  emailFailed,
}: {
  linkId: string | null;
  licenseeName: string;
  sentLine: string | null;
  openedLine: string | null;
  nudge: string | null;
  emailFailed: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-1.5 rounded-xl border border-rc-border bg-rc-bg-alt px-3 py-2.5 text-sm">
      {sentLine && <p className="font-semibold text-rc-ink">{sentLine}</p>}
      {emailFailed && <p className="text-rc-amber-deep">The email didn&apos;t send. Send it again, or copy the link and send it yourself.</p>}
      {openedLine && <p className="text-rc-muted">{openedLine}</p>}
      {nudge && <p className="font-semibold text-rc-amber-deep">{nudge}</p>}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await resendPack();
              setMessage(r.error ?? r.done ?? null);
            })
          }
          className="font-semibold text-rc-green-deep hover:underline"
        >
          Send again
        </button>
        {linkId && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await copyLicenseeLink(linkId);
                if (!r.url) return setMessage(r.error);
                try {
                  await navigator.clipboard.writeText(r.url);
                  setCopied(true);
                } catch {
                  setMessage(`Copy this link: ${r.url}`);
                }
              })
            }
            className="inline-flex items-center gap-1 font-semibold text-rc-green-deep hover:underline"
          >
            {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
      </div>
      <p className="text-xs text-rc-muted">{copyLinkHint(licenseeName)} Copying it is recorded.</p>
      {message && <p className="text-xs text-rc-ink">{message}</p>}
    </div>
  );
}
