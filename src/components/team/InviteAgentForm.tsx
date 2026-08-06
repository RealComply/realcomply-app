"use client";

import { useActionState, useState } from "react";
import { Copy, Check, UserPlus } from "lucide-react";
import { inviteAgent } from "@/lib/actions/team";

type InviteState = { error: string | null; inviteLink?: string };
const initialState: InviteState = { error: null };

// There's no outbound email sending yet (see tech-stack-notes.md — Workspace
// email migration is still an open thread), so this doesn't pretend to
// "send an invite." It generates the signup link and hands it to the
// licensee to send themselves — same manual-relay shape as everything else
// in this app until real email delivery is wired up.
export function InviteAgentForm() {
  const [state, formAction, pending] = useActionState(inviteAgent, initialState);
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!state.inviteLink) return;
    await navigator.clipboard.writeText(state.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-card border border-dashed border-rc-border bg-rc-bg-alt p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rc-green-soft text-rc-green-deep">
          <UserPlus size={16} />
        </span>
        <h3 className="text-sm font-semibold text-rc-ink">Add an agent</h3>
      </div>
      <p className="mt-1.5 text-xs text-rc-muted">
        Creates a signup link tied to this agency and this email address — send it to them yourself (text, email,
        whatever&rsquo;s easiest). They join your office when they sign up; it never creates a separate agency.
      </p>

      <form action={formAction} className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="email"
            name="email"
            placeholder="Agent's email"
            required
            className="w-56 rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
          <input
            type="text"
            name="fullName"
            placeholder="Full name (optional)"
            className="w-48 rounded-lg border border-rc-border px-2.5 py-1.5 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-rc-muted">
          <input type="checkbox" name="isLicenseeInCharge" className="accent-rc-green-deep" />
          Also a licensee in charge (e.g. a co-principal)
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Creating link…" : "Create invite link"}
        </button>
        {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
      </form>

      {state.inviteLink && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rc-green-deep/30 bg-white px-3 py-2 text-xs">
          <span className="flex-1 truncate text-rc-ink">{state.inviteLink}</span>
          <button
            type="button"
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1 rounded-full bg-rc-green-soft px-2.5 py-1 font-semibold text-rc-green-deep transition hover:opacity-80"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
