"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Pencil, UserRoundX, Undo2 } from "lucide-react";
import { updateStaffName, setStaffRole, archiveStaff, restoreStaff } from "@/lib/actions/team";
import type { ActionState } from "@/lib/actions/auth";

const initialState: ActionState = { error: null };

export type StaffPerson = {
  id: string;
  fullName: string | null;
  email: string;
  isAgent: boolean;
  isAssistant: boolean;
  isLicensee: boolean;
  archivedAt: string | null;
};

export type SupportableAgent = { id: string; name: string };

// One person on the office roster, and what the licensee can do about them.
//
// Adam, 26 Aug 2026: "as the licensee i should be able to edit staff… just
// name, title and ability to remove."
//
// Editing is behind a pencil rather than always on screen. The common case by
// a wide margin is reading the roster — who is here, who does what — and a page
// of open form fields makes that harder, not easier. The refusals live in the
// Server Action and the trigger; this component's job is to be quiet until
// asked and to show plainly what came back when something is refused.
export function StaffRow({
  person,
  isSelf,
  canManage,
  agents,
  subtitle,
}: {
  person: StaffPerson;
  isSelf: boolean;
  canManage: boolean;
  agents: SupportableAgent[];
  subtitle: string;
}) {
  const [editing, setEditing] = useState<"name" | "role" | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const nameAction = updateStaffName.bind(null, person.id);
  const roleAction = setStaffRole.bind(null, person.id);
  const [nameState, nameFormAction, namePending] = useActionState(nameAction, initialState);
  const [roleState, roleFormAction, rolePending] = useActionState(roleAction, initialState);

  const [removeState, setRemoveState] = useState<ActionState>(initialState);
  const [removePending, setRemovePending] = useState(false);

  async function runRemoval(action: (id: string) => Promise<ActionState>) {
    setRemovePending(true);
    setRemoveState(await action(person.id));
    setRemovePending(false);
    setConfirmingRemove(false);
  }

  const currentRole = person.isAssistant ? "assistant" : person.isLicensee ? "licensee" : "agent";
  const archived = Boolean(person.archivedAt);

  return (
    <li className={`px-4 py-3 text-sm ${archived ? "bg-rc-bg-alt" : ""}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] ${archived ? "opacity-40" : ""}`}
          style={{ background: "linear-gradient(155deg, #1d3a31 0%, #0d1f19 100%)" }}
        >
          {(person.fullName ?? person.email).charAt(0).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <p className={`font-medium ${archived ? "text-rc-faint line-through" : "text-rc-ink"}`}>
            {person.fullName ?? person.email}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-rc-faint">(you)</span>}
          </p>
          <p className="truncate text-xs text-rc-muted">
            {archived ? "Removed — their records are kept" : subtitle}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!archived && person.isLicensee && (
            <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] font-medium text-rc-green-deep">
              Licensee
            </span>
          )}
          {!archived && person.isAgent && (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-rc-muted">
              Agent
            </span>
          )}
          {!archived && person.isAssistant && (
            <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] font-medium text-rc-green-deep-600">
              Assistant
            </span>
          )}

          {canManage && !archived && (
            <button
              type="button"
              onClick={() => setEditing(editing ? null : "name")}
              aria-label={`Edit ${person.fullName ?? person.email}`}
              className="rounded-md p-1 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink"
            >
              <Pencil size={14} />
            </button>
          )}
          {canManage && archived && (
            <button
              type="button"
              disabled={removePending}
              onClick={() => runRemoval(restoreStaff)}
              className="inline-flex items-center gap-1 text-xs font-medium text-rc-green-deep transition hover:underline disabled:opacity-60"
            >
              <Undo2 size={13} /> {removePending ? "…" : "Bring back"}
            </button>
          )}
        </div>
      </div>

      {removeState.error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-rc-amber-deep">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{removeState.error}</span>
        </p>
      )}

      {editing && canManage && !archived && (
        <div className="mt-3 space-y-3 rounded-lg border border-rc-border bg-rc-bg-alt p-3">
          <div className="flex gap-3 text-xs font-medium">
            <button
              type="button"
              onClick={() => setEditing("name")}
              className={editing === "name" ? "text-rc-green-deep underline" : "text-rc-muted hover:text-rc-ink"}
            >
              Name
            </button>
            <button
              type="button"
              onClick={() => setEditing("role")}
              className={editing === "role" ? "text-rc-green-deep underline" : "text-rc-muted hover:text-rc-ink"}
            >
              Role
            </button>
          </div>

          {editing === "name" && (
            <form action={nameFormAction} className="flex flex-wrap items-end gap-2">
              <label className="text-[11px] font-medium text-rc-ink">
                <span className="block">Full name</span>
                <input
                  name="fullName"
                  defaultValue={person.fullName ?? ""}
                  required
                  className="mt-0.5 w-56 rounded-md border border-rc-border px-2 py-1.5 text-sm focus:border-rc-green-deep focus:outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={namePending}
                className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {namePending ? "Saving…" : "Save"}
              </button>
              {nameState.error && <p className="w-full text-xs text-rc-red">{nameState.error}</p>}
            </form>
          )}

          {editing === "role" && (
            <form action={roleFormAction} className="space-y-2">
              <label className="block text-[11px] font-medium text-rc-ink">
                <span className="block">Role</span>
                <select
                  name="role"
                  defaultValue={currentRole}
                  className="mt-0.5 w-56 rounded-md border border-rc-border px-2 py-1.5 text-sm focus:border-rc-green-deep focus:outline-none"
                >
                  <option value="agent">Agent</option>
                  <option value="assistant">Assistant</option>
                  <option value="licensee">Licensee in charge</option>
                </select>
              </label>

              {/* Shown whatever the current role is, because the licensee is
                  choosing what the person is about to become, not describing
                  what they are. The Server Action refuses an assistant with no
                  agents — that list is their access, and none means they can
                  see nothing. */}
              <fieldset className="rounded-md border border-rc-border bg-white p-2">
                <legend className="px-1 text-[11px] font-medium text-rc-muted">
                  If assistant, who do they support?
                </legend>
                <div className="space-y-1">
                  {agents.length === 0 ? (
                    <p className="text-[11px] text-rc-faint">No other agents in the office yet.</p>
                  ) : (
                    agents.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 text-xs text-rc-ink">
                        <input
                          type="checkbox"
                          name="supportsAgentIds"
                          value={a.id}
                          className="accent-rc-green-deep"
                        />
                        {a.name}
                      </label>
                    ))
                  )}
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={rolePending}
                className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {rolePending ? "Saving…" : "Save role"}
              </button>
              {roleState.error && (
                <p className="flex items-start gap-1.5 text-xs text-rc-amber-deep">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{roleState.error}</span>
                </p>
              )}
            </form>
          )}

          {!isSelf && (
            <div className="border-t border-rc-border pt-3">
              {!confirmingRemove ? (
                <button
                  type="button"
                  onClick={() => setConfirmingRemove(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-rc-muted transition hover:text-rc-red"
                >
                  <UserRoundX size={13} /> Remove from the office…
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs leading-relaxed text-rc-ink">
                    Remove <span className="font-semibold">{person.fullName ?? person.email}</span>? They lose access
                    immediately. Everything they did stays — their signatures, CPD records and the listings they ran
                    are the compliance record and aren&rsquo;t touched. You can bring them back at any time.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={removePending}
                      onClick={() => runRemoval(archiveStaff)}
                      className="rounded-md bg-rc-red px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      {removePending ? "Removing…" : "Remove"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingRemove(false)}
                      className="text-xs font-medium text-rc-muted hover:text-rc-ink"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
