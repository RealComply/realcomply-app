"use client";

import { useTransition } from "react";
import { Send, Undo2 } from "lucide-react";
import { requestAgentReview, clearAgentReview } from "@/lib/actions/compliance";

/**
 * The assistant's hand-over, and the agent's way of sending it back.
 *
 * Deliberately NOT a compliance item. It records that the assistant finished
 * their part and asked the agent to look — it attests nothing about the file
 * being compliant, and only the agent's signature does that. Making it an
 * item that goes "done" would put a green tick on a file for work nobody
 * licensed has reviewed yet, which is exactly the confusion the role exists
 * to avoid.
 *
 * It doesn't lock anything either. Work carries on while the agent reviews —
 * an offer doesn't wait — and the agent can hand it straight back.
 */
export function HandToAgent({
  propertyId,
  agentName,
  requestedAt,
  requestedByName,
  viewerIsAssistant,
}: {
  propertyId: string;
  agentName: string;
  requestedAt: string | null;
  requestedByName: string | null;
  viewerIsAssistant: boolean;
}) {
  const [pending, start] = useTransition();

  if (requestedAt) {
    const when = new Date(requestedAt).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });

    return (
      <div className="mt-6 rounded-card border border-rc-amber-deep/25 bg-rc-amber/10 px-4 py-3 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-rc-amber-deep">
              With {agentName} to review and sign
            </p>
            <p className="mt-0.5 text-xs text-rc-amber-deep/85">
              {requestedByName ? `${requestedByName} handed this over` : "Handed over"} {when}. Nothing is locked —
              keep working on it if something else comes in.
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => void clearAgentReview(propertyId))}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rc-amber-deep/30 bg-white px-3 py-1.5 text-xs font-semibold text-rc-amber-deep transition hover:bg-white/70 disabled:opacity-60"
          >
            <Undo2 size={13} />
            {viewerIsAssistant ? "Take it back" : "Send back"}
          </button>
        </div>
      </div>
    );
  }

  // Only the assistant is offered the hand-over. An agent working their own
  // file has nobody to hand it to.
  if (!viewerIsAssistant) return null;

  return (
    <div className="mt-6 rounded-card border border-rc-border bg-white px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-rc-ink">Hand to {agentName} for review</p>
          <p className="mt-0.5 text-xs text-rc-muted">
            Tells {agentName} the file is ready for them to review and sign. It doesn&rsquo;t sign anything and it
            doesn&rsquo;t lock the file.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => void requestAgentReview(propertyId))}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rc-green-deep px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          <Send size={13} />
          {pending ? "Sending…" : `Ready for ${agentName.split(" ")[0]}'s review`}
        </button>
      </div>
    </div>
  );
}
