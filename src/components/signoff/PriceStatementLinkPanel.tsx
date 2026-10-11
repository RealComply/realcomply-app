"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertTriangle, PenLine, RotateCw, Send, Sparkles, X } from "lucide-react";
import {
  issuePriceStatementLink,
  resendPriceStatementLink,
  withdrawPriceStatementLink,
  type PriceLinkState,
} from "@/lib/actions/signoff-links";
import { liveLink, type SignoffLink } from "@/lib/data/signoff-links";
import { PRICE_STATEMENT_MAX, espRangeText } from "@/lib/rules/price-statement";
import { STAGE_GATE_MESSAGE } from "@/lib/rules/esp-reasoning-gate";
import { formatAuTimestamp } from "@/lib/format-date";

// b4 by email: the agent's half (Adam, 12 Oct 2026, option (a)).
//
// Shown on the b4 card when nobody in the office is an active licensee in
// charge on RealComply. The agent (or their assistant) types the price
// statement exactly as it will be advertised and sends it. The licensee gets
// an email, opens the link, reads the words and the ESP on the file, and
// approves by typing their name. The card then completes on its own.
//
// The words are fixed when the request is made. To change them, "Change
// wording" withdraws the request and puts the words back in the box to edit
// and send again, so the licensee never approves words the agent has since
// changed. The ESP shown is fixed too, by the database: if it changes, or the
// ESP reasoning card is reopened, the request stops working and this panel
// says so.
//
// SENT IS A FACT, NOT AN ASSUMPTION, as on the final sign-off link: "Sent to"
// only when the email reached the provider (email_sent_at, 0047).

export function PriceStatementLinkPanel({
  propertyId,
  links,
  gateOpen,
  testMode,
  licenseeName,
  licenseeEmail,
  actsAsLicensee,
  stale,
  seed,
}: {
  propertyId: string;
  /** This listing's price statement requests, newest first. */
  links: SignoffLink[];
  /** The ESP reasoning card is complete (or the listing is a practice one). */
  gateOpen: boolean;
  testMode: boolean;
  licenseeName: string | null;
  licenseeEmail: string | null;
  /** The viewer can add the licensee's email in Team (the agent on their own plan). */
  actsAsLicensee: boolean;
  /** The live request can no longer be approved: the ESP or the ESP reasoning changed. */
  stale: boolean;
  /** The offering price read from the agency agreement (a3), to start the box with. */
  seed: string | null;
}) {
  const live = liveLink(links, "b4");
  // The newest request that is not live: expired, or approved on a card the
  // licensee later sent back. Its words are the best start for a new one.
  const last = live ? null : (links[0] ?? null);
  const expired = last !== null && last.signedAt === null;

  const startText = last?.priceStatement ?? seed ?? "";
  const [text, setText] = useState(startText);
  const fromSeed = !last?.priceStatement && Boolean(seed) && text === seed;

  const [sendState, send, sending] = useActionState<PriceLinkState, FormData>(
    issuePriceStatementLink.bind(null, propertyId),
    { error: null },
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  // The send's error stays in its state until the next send. Once the agent
  // has done something else on the card, it is old news and is not shown.
  const [settled, setSettled] = useState<PriceLinkState | null>(null);
  // Withdrawn here: an older expired request is not "your last request".
  const [withdrawn, setWithdrawn] = useState(false);

  function resend() {
    setError(null);
    setJustSent(false);
    setSettled(sendState);
    startTransition(async () => {
      const result = await resendPriceStatementLink(propertyId);
      if (result.error) setError(result.error);
      else setJustSent(true);
    });
  }

  function withdraw(id: string, refill: boolean) {
    setError(null);
    setJustSent(false);
    setSettled(sendState);
    startTransition(async () => {
      const result = await withdrawPriceStatementLink(id, propertyId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setWithdrawn(true);
      // "Change wording": the words go back in the box, to edit and send again.
      if (refill && result.priceStatement) setText(result.priceStatement);
    });
  }

  const shownError = error ?? (sendState !== settled ? sendState.error : null);
  const errorLine = shownError && (
    <p className="mt-2 text-xs font-medium text-rc-amber-deep" role="alert">
      {shownError}
    </p>
  );

  if (live) {
    const sendFailed = live.emailSentAt === null && live.emailAttempts > 0;
    const esp = espRangeText(live.espLow, live.espHigh);
    return (
      <div
        className={`rounded-md border px-3 py-2.5 ${
          stale || sendFailed ? "border-rc-amber/50 bg-rc-amber/10" : "border-rc-border bg-rc-bg-alt"
        }`}
      >
        {stale ? (
          <p className="flex items-start gap-1.5 text-xs font-semibold text-rc-amber-deep">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              The estimated selling price or the ESP reasoning has changed since this was sent, so your licensee
              can no longer approve it. Withdraw it and send a new one.
            </span>
          </p>
        ) : sendFailed ? (
          <>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-rc-amber-deep">
              <AlertTriangle size={13} aria-hidden="true" />
              <span className="break-all">Couldn&rsquo;t email {live.sentTo}</span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-rc-muted">The request is still valid. Send it again.</p>
          </>
        ) : (
          <p className="text-xs font-semibold text-rc-ink">
            Sent to <span className="break-all">{live.sentTo}</span> on{" "}
            {formatAuTimestamp(live.emailSentAt ?? live.createdAt)} for approval:
          </p>
        )}

        <p className="mt-1.5 break-words text-sm font-semibold text-rc-ink">&ldquo;{live.priceStatement}&rdquo;</p>
        {esp && <p className="mt-1 text-xs text-rc-muted">Estimated selling price shown: {esp}.</p>}

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {!stale && (
            <button
              type="button"
              onClick={resend}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
            >
              <RotateCw size={12} aria-hidden="true" />
              {pending ? "Working…" : justSent ? "Sent again" : "Send again"}
            </button>
          )}
          <button
            type="button"
            onClick={() => withdraw(live.id, true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-green-deep/40 disabled:opacity-60"
          >
            <PenLine size={12} aria-hidden="true" />
            Change wording
          </button>
          <button
            type="button"
            onClick={() => withdraw(live.id, false)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-muted transition hover:text-rc-ink disabled:opacity-60"
          >
            <X size={12} aria-hidden="true" />
            Withdraw
          </button>
        </div>

        {!stale && (
          <p className="mt-2 text-xs leading-relaxed text-rc-muted">
            Not approved yet. Expires {formatAuTimestamp(live.expiresAt)}. When they approve, this card completes on
            its own. Replies to that email go to you.
          </p>
        )}
        {errorLine}
      </div>
    );
  }

  // Nothing goes to the licensee from a practice listing: the database
  // refuses it too (0065). The listing can still move on, as practice ones do.
  if (testMode) {
    return (
      <p className="text-sm text-rc-muted">
        This is a practice listing, so nothing is sent to your licensee. Practice listings can move on without
        this card.
      </p>
    );
  }

  const email = licenseeEmail?.trim() || null;
  const noEmail = actsAsLicensee
    ? "Add your licensee in charge's email in Team settings first."
    : "There's no email on file for your licensee in charge. Contact RealComply support to add it.";
  const canSend = gateOpen && email !== null;

  return (
    <form action={send}>
      {expired && last && !withdrawn && (
        <p className="mb-2 rounded-md border border-rc-border bg-rc-bg-alt px-3 py-2 text-xs leading-relaxed text-rc-muted">
          Your last request expired on {formatAuTimestamp(last.expiresAt)} without approval. Send a new one.
        </p>
      )}
      <p className="text-sm text-rc-muted">
        Your licensee in charge doesn&rsquo;t use RealComply, so they approve the price statement by email.
      </p>

      <label htmlFor={`price-statement-${propertyId}`} className="mt-3 block text-xs text-rc-muted">
        The price statement being approved
        <span className="text-rc-amber-deep"> — required</span>
      </label>
      <textarea
        id={`price-statement-${propertyId}`}
        name="priceStatement"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={PRICE_STATEMENT_MAX}
        rows={2}
        required
        placeholder="e.g. Guide $750,000 – $790,000"
        className="mt-1 w-full rounded-md border border-rc-border px-2 py-1 text-sm"
      />
      {/* Only while the box still holds what was read from the agreement:
          the licensee approves these words, so the agent has to look at them. */}
      {fromSeed && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-rc-green-deep">
          <Sparkles size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Filled in from the offering price in the agency agreement. Check it matches the advertising exactly, and
            edit it if it doesn&rsquo;t.
          </span>
        </p>
      )}
      <p className="mt-1.5 text-xs leading-relaxed text-rc-muted">
        Type it exactly as it will appear in the advertising. Your licensee approves these exact words.
      </p>

      {email ? (
        <p className="mt-2 text-xs text-rc-muted">
          Goes to {licenseeName ? `${licenseeName} at ` : ""}
          <span className="break-all font-medium text-rc-ink">{email}</span>.
        </p>
      ) : (
        <p className="mt-2 text-xs font-medium text-rc-amber-deep">{noEmail}</p>
      )}

      {!gateOpen && <p className="mt-2 text-xs font-medium text-rc-amber-deep">{STAGE_GATE_MESSAGE}</p>}

      <button
        type="submit"
        disabled={sending || !canSend}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
      >
        <Send size={12} aria-hidden="true" />
        {sending ? "Sending…" : "Send to licensee for approval"}
      </button>
      {errorLine}
    </form>
  );
}
