"use client";

import { useActionState, useState } from "react";
import { grantOfficeManager, withdrawOfficeManager, type TeamOfficeManagerState } from "@/lib/actions/office-manager";
import { formatAuTimestamp } from "@/lib/format-date";

// Make office manager / Withdraw, on a staff row in Team, for the licensee in
// charge only (0093; mockup approved by Adam, 26 Oct 2026). The database
// decides; this only asks and shows what came back.

const initial: TeamOfficeManagerState = { error: null };

export function TeamOfficeManagerControls({
  personId,
  personName,
  wording,
  current,
}: {
  personId: string;
  personName: string;
  /** The words the licensee confirms. */
  wording: string;
  /** Their current approval, if they are office manager. */
  current: { approvedAt: string; approvedByName: string; viaLink: boolean; byMe: boolean } | null;
}) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [grantState, grantAction, granting] = useActionState(grantOfficeManager.bind(null, personId), initial);
  const [withdrawState, setWithdrawState] = useState<TeamOfficeManagerState>(initial);
  const [withdrawing, setWithdrawing] = useState(false);

  if (current) {
    return (
      <div className="mt-2 pl-11">
        <p className="text-xs text-rc-muted">
          Office manager since {formatAuTimestamp(current.approvedAt)}. Approved by{" "}
          {current.byMe ? "you" : current.approvedByName}
          {current.viaLink ? " by email link" : ""}.
        </p>
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1.5 inline-flex min-h-9 items-center rounded-full border border-[#f3b8b8] bg-white px-3 text-xs font-semibold text-[#a52f2f] transition hover:bg-[#fdecec]"
          >
            Withdraw
          </button>
        ) : (
          <div className="mt-2 rounded-card border border-[#f3b8b8] bg-white p-3">
            <p className="text-sm font-bold text-rc-ink">Withdraw {personName} as office manager?</p>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">
              {personName} loses the office side straight away. Their own listings and records stay as they are, and
              anything they uploaded for the office stays on file. We&rsquo;ll let {personName} know by email.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={withdrawing}
                onClick={async () => {
                  setWithdrawing(true);
                  setWithdrawState(await withdrawOfficeManager(personId));
                  setWithdrawing(false);
                  setOpen(false);
                }}
                className="inline-flex min-h-9 items-center rounded-full bg-[#c43a3a] px-4 text-xs font-bold text-white transition hover:bg-[#a52f2f] disabled:opacity-60"
              >
                {withdrawing ? "Withdrawing…" : "Withdraw approval"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-9 items-center rounded-full border border-rc-border bg-white px-4 text-xs font-semibold text-rc-ink"
              >
                Keep {personName.split(/\s+/)[0]} as office manager
              </button>
            </div>
          </div>
        )}
        {withdrawState.error && <p className="mt-1.5 text-xs text-rc-amber-deep">{withdrawState.error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 pl-11">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-9 items-center rounded-full border border-rc-green-deep/25 bg-white px-3 text-xs font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
        >
          Make office manager
        </button>
      ) : (
        <form action={grantAction} className="rounded-card border border-rc-green-deep/25 bg-rc-green-soft/50 p-3">
          <p className="text-sm font-bold text-rc-ink">Make {personName} office manager?</p>
          <p className="mt-1 text-xs leading-relaxed text-rc-muted">
            {personName} will look after Team, Office profile, registers, CPD, training, trust records, the SG Manual and
            billing. Price statement approvals, file sign-offs, annexure adoption, changing the licensee in charge and
            deleting compliance records stay with you.
          </p>
          <label className="mt-2 flex items-start gap-2 text-sm font-semibold text-rc-ink">
            <input
              type="checkbox"
              name="authorise"
              value="yes"
              checked={ticked}
              onChange={(e) => setTicked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-rc-green-deep"
            />
            <span>{wording}</span>
          </label>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={!ticked || granting}
              className="inline-flex min-h-9 items-center rounded-full bg-rc-green-deep px-4 text-xs font-bold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:bg-rc-border disabled:text-rc-muted"
            >
              {granting ? "Saving…" : "Make office manager"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-9 items-center rounded-full border border-rc-border bg-white px-4 text-xs font-semibold text-rc-ink"
            >
              Cancel
            </button>
          </div>
          {grantState.error && <p className="mt-1.5 text-xs text-rc-amber-deep">{grantState.error}</p>}
        </form>
      )}
    </div>
  );
}
