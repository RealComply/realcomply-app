import { formatAuTimestamp } from "@/lib/format-date";
import {
  CONFIRM_FIRST_NOTE,
  licenseeEmailLine,
  linkSendLines,
  waitingSentLine,
  type LicenseeEmailState,
  type LinkSend,
} from "@/lib/licensee-email/status";
import { SendConfirmButton } from "./SendConfirmButton";

// The Office profile's "Licensee email" card (0112; Master, 4 Nov 2026):
// where the licensee email stands, Send again while it waits, and where each
// kind of link last went, so whoever is waiting on a signature can spot a
// wrong address. Everyone in the office sees it.

export function LicenseeEmailCard({ state, sends }: { state: LicenseeEmailState; sends: LinkSend[] }) {
  const lines = linkSendLines(sends, formatAuTimestamp);
  const waiting = state.kind === "waiting";
  return (
    <div
      className={`rounded-card border bg-white p-4 text-sm shadow-card ${waiting ? "border-rc-amber/40" : "border-rc-border"}`}
    >
      <h3 className="text-sm font-semibold text-rc-ink">Licensee email</h3>
      <p className={`mt-1 ${waiting ? "font-semibold text-rc-amber-deep" : "text-rc-ink"}`}>
        {licenseeEmailLine(state, formatAuTimestamp)}
      </p>
      {state.kind === "waiting" && (
        <>
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">{waitingSentLine(state, formatAuTimestamp)}</p>
          <SendConfirmButton label={state.lastSentAt ? "Send again" : "Send the confirm email"} />
        </>
      )}
      {state.kind !== "none" && <p className="mt-2 text-xs leading-relaxed text-rc-muted">{CONFIRM_FIRST_NOTE}</p>}
      {lines.length > 0 && (
        <div className="mt-3 border-t border-rc-border pt-3">
          <p className="text-xs font-semibold text-rc-ink">Sent to your licensee</p>
          <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-rc-muted">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
