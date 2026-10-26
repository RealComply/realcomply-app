"use client";

import { Mail, X } from "lucide-react";
import { revokeInvite } from "@/lib/actions/team";
import { formatAuTimestamp } from "@/lib/format-date";
import { inviteRoleLabel } from "@/lib/team/invite-options";
import type { AgencyInvite } from "@/lib/types";

export function PendingInvitesList({
  invites,
  canManage,
  approvedByName,
}: {
  invites: AgencyInvite[];
  canManage: boolean;
  /** Who sent an office manager invite, by profile id, for the approval line. */
  approvedByName: (id: string) => string | null;
}) {
  if (invites.length === 0) return null;

  return (
    <div className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
        Pending invites ({invites.length})
      </h3>
      <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
        {invites.map((invite) => (
          <li key={invite.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rc-amber/15 text-rc-amber-deep">
                  <Mail size={14} />
                </span>
                <div>
                  <p className="font-medium text-rc-ink">{invite.full_name ?? invite.email}</p>
                  {/* Every role named (10 Oct 2026; five roles since 0095): an
                      invite that said "agent" when it was for something else
                      misled whoever sent it. */}
                  <p className="text-xs text-rc-muted">
                    {invite.email} · invited as {inviteRoleLabel(invite).toLowerCase()}
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
            </div>
            {/* The licensee's approval, made on the invite (0095). */}
            {invite.is_office_manager && invite.office_manager_wording && (
              <p className="mt-1.5 pl-10 text-xs leading-relaxed text-rc-muted">
                Approved by {(invite.invited_by && approvedByName(invite.invited_by)) || "the licensee in charge"}
                {invite.office_manager_authorised_at ? ` on ${formatAuTimestamp(invite.office_manager_authorised_at)}` : ""}:{" "}
                &ldquo;{invite.office_manager_wording}&rdquo; They become office manager when they join.
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
