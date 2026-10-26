"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UserCog } from "lucide-react";
import { askLicenseeToApprove, cancelOfficeManagerRequest, type AskState } from "@/lib/actions/office-manager";
import type { OfficeManagerCard, OfficeManagerNews } from "@/lib/office-manager/card";
import { formatAuTimestamp } from "@/lib/format-date";
import { useHomeNotice } from "./useHomeNotice";

// The office manager card on Home (0093; mockup approved by Adam, 26 Oct
// 2026, with his wording for the first state). Which state shows is decided
// in lib/office-manager/card.ts.
//
// Seen once (Adam, 26 Oct 2026, 0096): "approved" and "withdrawn" show once,
// with "Got it". After "Got it" or a second visit, approved becomes the small
// line at the top of Home (OfficeManagerLine) and withdrawn goes.

const initial: AskState = { error: null, sent: false };

const OFFICE_SIDE = "Team, Office profile, registers, CPD, training, trust records, the SG Manual and billing";
const LICENSEE_KEEPS =
  "Price statement approvals, file sign-offs, annexure adoption, changing the licensee in charge and deleting compliance records";

function Chip({ tone, children }: { tone: "green" | "amber" | "grey"; children: React.ReactNode }) {
  const cls =
    tone === "green"
      ? "border-rc-green-deep/25 bg-rc-green-soft text-rc-green-deep-600"
      : tone === "amber"
        ? "border-rc-amber-deep/30 bg-rc-amber/10 text-rc-amber-deep"
        : "border-rc-border bg-rc-bg-alt text-rc-muted";
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function GotIt({ onClick, pending }: { onClick: () => void; pending: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center self-start rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      Got it
    </button>
  );
}

function AskButton({ label, secondary = false }: { label: string; secondary?: boolean }) {
  const [state, action, pending] = useActionState(askLicenseeToApprove, initial);
  return (
    <form action={action} className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        className={
          secondary
            ? "inline-flex min-h-11 items-center justify-center self-start rounded-full border border-rc-border bg-white px-5 py-2.5 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep disabled:cursor-not-allowed disabled:text-rc-muted"
            : "inline-flex min-h-11 items-center justify-center self-start rounded-full bg-rc-green-deep px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
        }
      >
        {pending ? "Sending…" : label}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function OfficeManagerHomeCard({ card }: { card: OfficeManagerCard }) {
  const first = card.licenseeName.split(/\s+/)[0] || card.licenseeName;
  const notice = useHomeNotice(card.kind === "approved" || card.kind === "withdrawn" ? card.noticeKey : null);
  if (notice.hidden) return null;

  if (card.kind === "ask") {
    return (
      <section aria-label="Office manager" className="mt-6 rounded-card border border-rc-border bg-white px-4 py-4 shadow-card sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rc-green-soft text-rc-green-deep">
            <UserCog size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 space-y-2">
            <Chip tone="green">Office manager</Chip>
            <h2 className="text-base font-bold text-rc-ink">Ask {card.licenseeName} to make you office manager</h2>
            <p className="text-sm leading-relaxed text-rc-muted">
              {card.licenseeName}, your licensee in charge, isn&rsquo;t on RealComply. The office side of your account (
              {OFFICE_SIDE}) is overseen by the licensee or an approved office manager.
            </p>
            {card.licenseeEmail ? (
              <>
                <p className="text-sm leading-relaxed text-rc-muted">
                  We&rsquo;ll email {first} a link at <strong className="text-rc-ink">{card.licenseeEmail}</strong>. They
                  approve by typing their name. They don&rsquo;t need an account.
                </p>
                <AskButton label={`Ask ${first} to approve`} />
                <p className="text-xs leading-relaxed text-rc-muted">
                  That address is the licensee&rsquo;s email in Office profile. If it&rsquo;s wrong, email
                  admin@realcomply.com.au and we&rsquo;ll correct it.
                </p>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-rc-amber-deep">
                There&rsquo;s no email for your licensee in charge. Email admin@realcomply.com.au and we&rsquo;ll add it.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (card.kind === "waiting") {
    return (
      <section
        aria-label="Office manager, waiting"
        className="mt-6 rounded-card border border-rc-amber-deep/30 bg-white px-4 py-4 shadow-card sm:px-5"
      >
        <div className="space-y-2">
          <Chip tone="amber">Waiting for {first}</Chip>
          <h2 className="text-base font-bold text-rc-ink">
            Waiting for {card.licenseeName} to approve you as office manager
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-rc-muted">Sent</dt>
            <dd className="min-w-0 break-words text-rc-ink">
              {card.sentAt ? `${formatAuTimestamp(card.sentAt)}, to ${card.sentTo}` : `Not sent yet, to ${card.sentTo}`}
            </dd>
          </dl>
          {card.emailFailed && (
            <p role="alert" className="text-sm text-rc-amber-deep">
              The email could not be sent. Try sending it again.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-3 pt-1">
            <AskButton label="Send again" secondary />
            <form action={cancelOfficeManagerRequest}>
              <button
                type="submit"
                className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-rc-muted underline hover:text-rc-ink"
              >
                Cancel the request
              </button>
            </form>
          </div>
        </div>
      </section>
    );
  }

  if (card.kind === "approved") {
    return (
      <section
        aria-label="Office manager, approved"
        className="mt-6 rounded-card border border-rc-green-deep/25 bg-white px-4 py-4 shadow-card sm:px-5"
      >
        <div className="space-y-2">
          <Chip tone="green">Office manager</Chip>
          <h2 className="text-base font-bold text-rc-ink">You&rsquo;re now office manager</h2>
          <p className="text-sm leading-relaxed text-rc-muted">
            {card.approvedByName} approved this {card.viaLink ? "by email link" : "in Team"} on{" "}
            {formatAuTimestamp(card.approvedAt)}. Team, Office profile, Registers, Training, Trust accounts and the SG
            Manual are now in your menu.
          </p>
          <p className="text-sm leading-relaxed text-rc-muted">
            {LICENSEE_KEEPS} stay with {card.approvedByName}
            {card.viaLink ? ", by email link" : ""}.
          </p>
          <Link href="/dashboard/document-signoffs#office-managers" className="inline-block text-sm font-semibold text-rc-green-deep hover:underline">
            See the approval in Sign-offs &rarr;
          </Link>

          <div className="pt-1">
            <GotIt onClick={notice.gotIt} pending={notice.pending} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Office manager, withdrawn" className="mt-6 rounded-card border border-rc-border bg-white px-4 py-4 shadow-card sm:px-5">
      <div className="space-y-2">
        <Chip tone="grey">Withdrawn</Chip>
        <h2 className="text-base font-bold text-rc-ink">{card.withdrawnByName} withdrew your office manager approval</h2>
        <p className="text-sm leading-relaxed text-rc-muted">
          On {formatAuTimestamp(card.withdrawnAt)}. Your own listings and records are as they were. Anything you uploaded
          for the office stays on file.
        </p>
        <div className="flex flex-wrap items-start gap-3 pt-1">
          <GotIt onClick={notice.gotIt} pending={notice.pending} />
          {card.mayAskAgain && <AskButton label={`Ask ${first} again`} secondary />}
        </div>
      </div>
    </section>
  );
}

/**
 * The licensee in charge's Home, once per new office manager (0096): who,
 * approved by whom and when, and what stays with the licensee. Then the
 * small line.
 */
export function OfficeManagerNewsCard({ news }: { news: OfficeManagerNews }) {
  const notice = useHomeNotice(news.noticeKey);
  if (notice.hidden) return null;
  const first = news.personName.split(/\s+/)[0] || news.personName;
  return (
    <section
      aria-label="Office manager, approved"
      className="mt-6 rounded-card border border-rc-green-deep/25 bg-white px-4 py-4 shadow-card sm:px-5"
    >
      <div className="space-y-2">
        <Chip tone="green">Office manager</Chip>
        <h2 className="text-base font-bold text-rc-ink">{news.personName} is now office manager</h2>
        <p className="text-sm leading-relaxed text-rc-muted">
          {news.approvedByViewer ? "You" : news.approvedByName} approved this{" "}
          {news.viaLink ? "by email link" : "in Team"} on {formatAuTimestamp(news.approvedAt)}. {first} can now manage{" "}
          {OFFICE_SIDE}.
        </p>
        <p className="text-sm leading-relaxed text-rc-muted">{LICENSEE_KEEPS} stay with you.</p>
        <div className="pt-1">
          <GotIt onClick={notice.gotIt} pending={notice.pending} />
        </div>
      </div>
    </section>
  );
}
