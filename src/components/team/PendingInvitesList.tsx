"use client";

import { Mail, X } from "lucide-react";
import { revokeInvite } from "@/lib/actions/team";
import type { AgencyInvite } from "@/lib/types";

export function PendingInvitesList({ invites, canManage }: { invites: AgencyInvite[]; canManage: boolean }) {
  if (invites.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
        Pending invites ({invites.length})
      </h3>
      <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
        {invites.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rc-amber/15 text-rc-amber-deep">
                <Mail size={14} />
              </span>
              <div>
                <p className="font-medium text-rc-ink">{invite.full_name ?? invite.email}</p>
                <p className="text-xs text-rc-muted">
                  {invite.email}
                  {invite.is_licensee_in_charge ? " · invited as licensee in charge" : " · invited as agent"}
                </p>
              </div>
            </div>
            {canManage && (
              <form action={revokeInvite.bind(null, invite.id)}>
                <button
                  type="submit"
                  className="flex items-center gap-1 rounded-full border border-rc-border px-2.5 py-1 text-xs font-medium text-rc-muted transition hover:border-rc-amber-deep/40 hover:text-rc-amber-deep"
                >
                  <X size={12} /> Revoke
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
