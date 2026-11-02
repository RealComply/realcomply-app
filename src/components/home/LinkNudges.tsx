import Link from "next/link";
import type { SignoffNudge } from "@/lib/data/link-nudges";
import type { AnnexureLinkStatus } from "@/lib/links/delivery";

// Email that gets through (Adam, 2 Nov 2026; 0107): "after 2 business days
// unopened, a nudge on Home and the card".

/** The file sign-off links this person sent that haven't been opened. Copy link is on the listing's card. */
export function UnopenedSignoffLinks({ nudges }: { nudges: SignoffNudge[] }) {
  if (nudges.length === 0) return null;
  return (
    <section
      aria-label="Sign-off links not opened"
      className="mt-6 rounded-card border border-rc-amber-deep/25 bg-rc-amber/10 px-4 py-3.5"
    >
      <h2 className="text-sm font-semibold text-rc-amber-deep">
        {nudges.length === 1 ? "A sign-off link hasn't been opened" : `Sign-off links not opened (${nudges.length})`}
      </h2>
      <ul className="mt-2.5 space-y-1.5">
        {nudges.map((n) => (
          <li key={n.requestId}>
            <Link
              href={n.href}
              className="block rounded-lg bg-white px-3 py-2.5 text-sm shadow-card transition hover:bg-white/70"
            >
              <span className="font-medium text-rc-ink">{n.address}</span>
              <span role="status" className="mt-0.5 block leading-relaxed text-rc-amber-deep">
                {n.text}
              </span>
              {n.sentLine && <span className="mt-0.5 block text-xs text-rc-muted">{n.sentLine}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The annexure link while it waits on the licensee in charge. Status and the nudge; no Copy link (option 2). */
export function AnnexureLinkCard({ status }: { status: AnnexureLinkStatus | null }) {
  if (!status) return null;
  return (
    <section
      aria-label="The annexure, waiting"
      className={`mt-6 rounded-card border bg-white px-4 py-4 shadow-card sm:px-5 ${
        status.nudge ? "border-rc-amber-deep/30" : "border-rc-border"
      }`}
    >
      <div className="space-y-2">
        <h2 className="text-base font-bold text-rc-ink">
          Waiting for {status.licenseeName} to adopt the annexure
        </h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-rc-muted">Sent</dt>
          <dd className="min-w-0 break-words text-rc-ink">
            {status.sentLine ? `${status.sentLine.replace(/^Sent /, "")}, to ${status.sentTo}` : `To ${status.sentTo}`}
          </dd>
          {status.openedLine && (
            <>
              <dt className="text-rc-muted">Opened</dt>
              <dd className="min-w-0 break-words text-rc-ink">{status.openedLine.replace(/^Opened /, "")}</dd>
            </>
          )}
        </dl>
        {status.nudge && (
          <p role="status" className="text-sm font-semibold leading-relaxed text-rc-amber-deep">
            {status.nudge}
          </p>
        )}
      </div>
    </section>
  );
}
