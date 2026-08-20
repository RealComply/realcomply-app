"use client";

import { useActionState, useState } from "react";
import { Copy, Check, UserPlus } from "lucide-react";
import { inviteAgent } from "@/lib/actions/team";
import type { Profile } from "@/lib/types";

type InviteState = { error: string | null; inviteLink?: string };
const initialState: InviteState = { error: null };

// There's no outbound email sending yet (see tech-stack-notes.md — Workspace
// email migration is still an open thread), so this doesn't pretend to
// "send an invite." It generates the signup link and hands it to the
// licensee to send themselves — same manual-relay shape as everything else
// in this app until real email delivery is wired up.
// Roles, 20 Aug 2026. This replaced a single "also a licensee in charge"
// tick, which could only ever describe two of the three people who work in an
// office. An assistant is the third: they prepare files for one or more
// agents and cannot sign them.
type Role = "agent" | "assistant" | "licensee";

const ROLES: Array<{ value: Role; label: string; hint: string }> = [
  { value: "agent", label: "Agent", hint: "Own listings, signs their own files." },
  { value: "assistant", label: "Assistant", hint: "Prepares files for one or more agents." },
  { value: "licensee", label: "Licensee in charge", hint: "Sees everything, final sign-off." },
];

export function InviteAgentForm({ agents }: { agents: Profile[] }) {
  const [state, formAction, pending] = useActionState(inviteAgent, initialState);
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState<Role>("agent");

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
        <h3 className="text-sm font-semibold text-rc-ink">Invite someone</h3>
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
        <fieldset className="pt-1">
          <legend className="text-xs font-medium text-rc-ink">What do they do here?</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className={`min-w-[9.5rem] flex-1 cursor-pointer rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                  role === r.value
                    ? "border-rc-green-deep bg-rc-green-soft text-rc-green-deep"
                    : "border-rc-border bg-white text-rc-ink hover:border-rc-green"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => setRole(r.value)}
                  className="sr-only"
                />
                {r.label}
                <span className="mt-0.5 block text-[11px] font-normal leading-snug text-rc-muted">{r.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Which agents an assistant supports. This IS their access — the
            listings they can see are exactly the ones belonging to the people
            ticked here, so it is asked at invite time rather than left to be
            configured afterwards and forgotten. */}
        {role === "assistant" && (
          <div className="rounded-lg border border-rc-border bg-white px-3 py-2.5">
            <p className="text-xs font-medium text-rc-ink">Which agents do they support?</p>
            {agents.length === 0 ? (
              <p className="mt-1 text-[11px] text-rc-amber-deep">
                There are no agents in the office yet — add one before inviting an assistant.
              </p>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {agents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-xs text-rc-ink">
                    <input
                      type="checkbox"
                      name="supportsAgentIds"
                      value={a.id}
                      className="accent-rc-green-deep"
                    />
                    {a.full_name ?? a.email}
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-rc-muted">
              They&rsquo;ll see only these agents&rsquo; listings — not the rest of the office. You can change it any
              time.
            </p>
          </div>
        )}
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
