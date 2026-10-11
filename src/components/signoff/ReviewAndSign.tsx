"use client";

import { useState } from "react";
import { SignoffForm } from "@/components/signoff/SignoffForm";
import { SendBackForm } from "@/components/signoff/SendBackForm";
import { sendBackWithLink } from "@/lib/actions/send-back";
import type { ReviewCard } from "@/lib/data/send-backs";

// The emailed sign-off page's working half (Adam, 12 Oct 2026): the file to
// review, sending it back, and the signature box last. Once the file has been
// sent back the link no longer works, so the signature box goes with it.

export function ReviewAndSign({
  token,
  propertyAddress,
  cards,
  agentName,
}: {
  token: string;
  propertyAddress: string;
  cards: ReviewCard[];
  agentName: string | null;
}) {
  const [sentBack, setSentBack] = useState(false);
  const sendBack = sendBackWithLink.bind(null, token);

  return (
    <>
      <section className="mt-6 rounded-card border border-rc-border bg-white px-5 py-4">
        <h2 className="text-base font-bold text-rc-ink">Review the file</h2>
        <p className="mt-1 text-sm leading-relaxed text-rc-muted">
          The full compliance file for {propertyAddress}: every step, its dates and notes, and the agent&rsquo;s
          signature. Read it before signing.
        </p>
        {!sentBack && (
          <>
            {/* The file ON the page, read where it is signed (Adam, 12 Oct
                2026: "I don't want them to have to download it"). The same
                audit pack the agent downloads, from /signoff/[token]/file.
                Some phones won't show a PDF inside a page, so opening it in
                its own tab and saving it stay underneath. */}
            <iframe
              src={`/signoff/${token}/file`}
              title={`The compliance file for ${propertyAddress}`}
              className="mt-3 h-[75vh] min-h-[420px] w-full rounded-md border border-rc-border bg-rc-bg-alt"
            />
            <p className="mt-2 text-xs text-rc-muted">
              Can&rsquo;t see the file above?{" "}
              <a href={`/signoff/${token}/file`} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                Open it in a new tab
              </a>
              {" · "}
              <a href={`/signoff/${token}/file?download=1`} rel="noreferrer" className="font-semibold underline">
                Download a copy
              </a>
            </p>
          </>
        )}
        <SendBackForm cards={cards} action={sendBack} agentName={agentName} onSent={() => setSentBack(true)} />
      </section>

      {!sentBack && (
        <>
          <h2 className="mt-8 text-base font-bold text-rc-ink">Sign off</h2>
          <SignoffForm token={token} />
        </>
      )}
    </>
  );
}
