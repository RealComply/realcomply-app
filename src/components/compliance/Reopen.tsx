"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { markReopenedCardDone, reopenCard } from "@/lib/actions/compliance";
import { declineReopen, requestReopen } from "@/lib/actions/reopen-requests";
import {
  CONFIRM_CANCEL_SIGNOFF,
  LICENSEE_SIGNOFF_KEYS,
  MARK_DONE_AGAIN_KEYS,
  ONLY_LICENSEE_SIGNED_FILE,
  ONLY_LICENSEE_SIGNOFF,
  REOPEN_REASON_MAX,
  cancellationLine,
  fileSignoffCancelledLine,
  priceApprovalReopenedLine,
  reopenedLine,
  requestFor,
  requestLine,
  showsSharedReopen,
  type Cancellation,
  type ReopenRequest,
  type ReopenWhy,
} from "@/lib/rules/reopen";
import type { PropertyItem } from "@/lib/types";

// Reopening a card on a sales listing (Adam, 28 Oct 2026; see
// lib/rules/reopen.ts). One provider for the page, so every card kind finds
// whether the file is signed off, who is looking, the requests to reopen and
// the cancelled approvals without the page threading them through each card.

export type ReopenPage = {
  propertyId: string;
  /** The licensee has signed the file off: nothing on it changes until they reopen a card. */
  signedOff: boolean;
  viewer: { id: string; isLicensee: boolean };
  names: Record<string, string>;
  /** Card titles by key, for "because … was reopened". */
  titles: Record<string, string>;
  requests: ReopenRequest[];
  cancellations: Cancellation[];
};

const ReopenContext = createContext<ReopenPage | null>(null);

export function ReopenProvider({ value, children }: { value: ReopenPage; children: ReactNode }) {
  return <ReopenContext.Provider value={value}>{children}</ReopenContext.Provider>;
}

export function useReopen(): ReopenPage | null {
  return useContext(ReopenContext);
}

/** A request to reopen this card that is waiting on the licensee. */
export function useWaitingRequest(itemKey: string): ReopenRequest | null {
  const ctx = useContext(ReopenContext);
  return ctx?.requests.find((r) => r.itemKey === itemKey && r.status === "waiting") ?? null;
}

const REOPEN_BUTTON =
  "rounded-md border border-rc-border px-3 py-1.5 text-xs font-medium text-rc-muted transition hover:bg-rc-bg-alt disabled:opacity-60";
const DONE_BUTTON =
  "rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60";

type Stamp = { reopenedBy?: string; reopenedAt?: string; reopenedBecause?: string; reopenedWhy?: ReopenWhy };

/**
 * Under every card's body: who reopened it and why, the cancelled approvals
 * and signatures it carries, a request to reopen it, and the shared Reopen
 * (or Mark done again) where the card has none of its own.
 */
export function CardReopenArea({
  item,
  status,
  current,
}: {
  item: { key: string; kind: string };
  status?: string | null;
  current?: PropertyItem;
}) {
  const ctx = useReopen();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "confirm" | "asking">("idle");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  if (!ctx) return null;

  const name = (id: string | null | undefined) => (id && ctx.names[id]) || "a team member";
  const title = (key: string) => ctx.titles[key] ?? key;
  const isOpen = !status || status === "open";
  const stamp = (current?.data ?? {}) as Stamp;
  // Where the licensee signs by email their signature card isn't on the
  // page, so its history shows on "Send to licensee".
  const historyKeys = item.key === "send_licensee" ? ["sign_licensee"] : [item.key];
  const history = ctx.cancellations.filter((c) => historyKeys.includes(c.itemKey));
  const request = requestFor(ctx.requests, item.key);
  const waiting = request?.status === "waiting" ? request : null;
  const showReopen = showsSharedReopen(item, status, ctx.signedOff);
  const showMarkDone = isOpen && Boolean(stamp.reopenedAt) && MARK_DONE_AGAIN_KEYS.has(item.key) && !ctx.signedOff;

  // Why it is open again. b4 says what the licensee has to do; the signature
  // cards say the file needs signing off again; anything else who and when.
  let reopened: string | null = null;
  if (isOpen && stamp.reopenedAt) {
    if (item.key === "b4") {
      reopened = priceApprovalReopenedLine({
        name: name(stamp.reopenedBy),
        at: stamp.reopenedAt,
        why: stamp.reopenedWhy ?? null,
        becauseTitle: stamp.reopenedBecause ? title(stamp.reopenedBecause) : null,
      });
    } else if (stamp.reopenedWhy === "file_reopened") {
      reopened = fileSignoffCancelledLine({
        name: name(stamp.reopenedBy),
        at: stamp.reopenedAt,
        becauseTitle: stamp.reopenedBecause && stamp.reopenedBecause !== item.key ? title(stamp.reopenedBecause) : null,
      });
    } else {
      reopened = reopenedLine(name(stamp.reopenedBy), stamp.reopenedAt);
    }
  }

  function run(cancelSignoff: boolean) {
    setError(null);
    setNote(null);
    start(async () => {
      const result = await reopenCard(ctx!.propertyId, item.key, cancelSignoff);
      if (result.needsConfirm) {
        setMode("confirm");
        return;
      }
      if (result.error) setError(result.error);
      setMode("idle");
    });
  }

  function pressReopen() {
    setError(null);
    if (ctx!.signedOff && !ctx!.viewer.isLicensee) {
      setNote(ONLY_LICENSEE_SIGNED_FILE);
      setMode(waiting ? "idle" : "asking");
      return;
    }
    if (LICENSEE_SIGNOFF_KEYS.has(item.key) && !ctx!.viewer.isLicensee) {
      setNote(ONLY_LICENSEE_SIGNOFF);
      return;
    }
    if (ctx!.signedOff) {
      setMode("confirm");
      return;
    }
    run(false);
  }

  if (!reopened && history.length === 0 && !request && !showReopen && !showMarkDone) return null;

  return (
    <div className="mt-3 space-y-2">
      {reopened && <p className="text-xs text-rc-muted">{reopened}</p>}

      {history.length > 0 && (
        <div className="rounded-lg bg-rc-bg-alt px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-rc-faint">
            {item.key === "b4" ? "Earlier approvals, cancelled" : "Earlier signatures, cancelled"}
          </p>
          <ul className="mt-1 space-y-1">
            {history.map((c) => (
              <li key={c.id} className="text-xs leading-relaxed text-rc-muted">
                {cancellationLine(c, (id) => name(id), title)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {request && (ctx.signedOff || request.status !== "waiting") && (
        <div className={waiting ? "rounded-lg border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2" : ""}>
          <p className={`text-xs leading-relaxed ${waiting ? "text-rc-ink" : "text-rc-muted"}`}>
            {requestLine(request, ctx.viewer, name)}
          </p>
          {waiting && ctx.viewer.isLicensee && mode !== "confirm" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={() => setMode("confirm")} className={REOPEN_BUTTON}>
                Reopen
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    const result = await declineReopen(waiting.id, ctx.propertyId);
                    if (result.error) setError(result.error);
                  });
                }}
                className={REOPEN_BUTTON}
              >
                Decline
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "confirm" && (
        <div role="alertdialog" aria-label="Reopen this card?" className="rounded-lg border border-rc-amber-deep/30 bg-rc-amber/10 px-3 py-2.5">
          <p className="text-sm text-rc-ink">{CONFIRM_CANCEL_SIGNOFF}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => run(true)} className={DONE_BUTTON}>
              {pending ? "Reopening…" : "Yes, reopen"}
            </button>
            <button type="button" disabled={pending} onClick={() => setMode("idle")} className={REOPEN_BUTTON}>
              No
            </button>
          </div>
        </div>
      )}

      {note && (
        <p role="alert" className="text-sm font-medium text-rc-amber-deep">
          {note}
        </p>
      )}

      {mode === "asking" && !waiting && (
        <form
          className="space-y-2 rounded-lg bg-rc-bg-alt p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const result = await requestReopen(ctx.propertyId, item.key, reason);
              if (result.error) {
                setError(result.error);
                return;
              }
              setReason("");
              setNote(null);
              setMode("idle");
            });
          }}
        >
          <label htmlFor={`reopen-reason-${item.key}`} className="block text-xs font-medium text-rc-muted">
            Ask the licensee to reopen it. Why does it need reopening?
          </label>
          <textarea
            id={`reopen-reason-${item.key}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REOPEN_REASON_MAX}
            rows={2}
            className="w-full rounded-md border border-rc-border bg-white px-2 py-1.5 text-sm"
          />
          <button type="submit" disabled={pending || !reason.trim()} className={DONE_BUTTON}>
            {pending ? "Sending…" : "Ask the licensee to reopen it"}
          </button>
        </form>
      )}

      {(showReopen || showMarkDone) && mode !== "confirm" && (
        <div className="flex flex-wrap gap-2">
          {showMarkDone && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const result = await markReopenedCardDone(ctx.propertyId, item.key);
                  if (result.error) setError(result.error);
                });
              }}
              className={DONE_BUTTON}
            >
              Mark done
            </button>
          )}
          {showReopen && !(waiting && ctx.viewer.isLicensee) && (
            <button type="button" disabled={pending} onClick={pressReopen} className={REOPEN_BUTTON}>
              {pending ? "Reopening…" : "Reopen"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-rc-amber-deep">
          {error}
        </p>
      )}
    </div>
  );
}
