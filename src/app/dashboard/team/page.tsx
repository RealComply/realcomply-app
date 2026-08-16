import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LicenseeEmailForm } from "@/components/team/LicenseeEmailForm";
import { requireProfile } from "@/lib/data/current-profile";
import { InviteAgentForm } from "@/components/team/InviteAgentForm";
import { PendingInvitesList } from "@/components/team/PendingInvitesList";
import type { AgencyInvite, Profile } from "@/lib/types";

// Team — where the licensee in charge adds real agents to the office
// profile. Every agent used to have to sign up independently, which
// bootstrap_agency() always turned into a brand-new separate agency — there
// was no way for a second person to actually join Adam's office. This page
// is the licensee's roster: who's already in, who's invited and hasn't
// joined yet, and the form to invite someone new (see accept_invite in
// 0006_agency_invites.sql for how the join itself works).
export default async function TeamPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: staffRows }, { data: inviteRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("agency_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }),
  ]);

  // Read here rather than in the component so the form is a client component
  // with a plain prop, not another round trip.
  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("licensee_email, website_url")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const agencyDetails = agencyRow as { licensee_email?: string | null; website_url?: string | null } | null;
  const licenseeEmail = agencyDetails?.licensee_email ?? null;
  const websiteUrl = agencyDetails?.website_url ?? null;

  const staff = (staffRows ?? []) as Profile[];
  const invites = (inviteRows ?? []) as AgencyInvite[];

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Team</h1>
            <p className="mt-1 text-sm text-rc-muted">Who&rsquo;s in your office, and who&rsquo;s been invited.</p>
          </div>
          <Link href="/dashboard/home" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            ← Home
          </Link>
        </div>

        {profile.is_licensee_in_charge && (
          <div className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
              Sign-off
            </h3>
            <LicenseeEmailForm current={licenseeEmail} website={websiteUrl} />
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
            Staff ({staff.length})
          </h3>
          <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
                  style={{ background: "linear-gradient(155deg, #1d3a31 0%, #0d1f19 100%)" }}
                >
                  {(s.full_name ?? s.email).charAt(0).toUpperCase()}
                </span>
                <div className="flex-1">
                  <p className="font-medium text-rc-ink">
                    {s.full_name ?? s.email}
                    {s.id === profile.id && <span className="ml-1.5 text-xs font-normal text-rc-faint">(you)</span>}
                  </p>
                  <p className="text-xs text-rc-muted">{s.email}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {s.is_licensee_in_charge && (
                    <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] font-medium text-rc-green-deep">
                      Licensee
                    </span>
                  )}
                  {s.is_agent && (
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-rc-muted">
                      Agent
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <PendingInvitesList invites={invites} canManage={profile.is_licensee_in_charge} />

        {profile.is_licensee_in_charge ? (
          <div className="mt-6">
            <InviteAgentForm />
          </div>
        ) : (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-rc-faint">
            <Users size={13} /> Only the licensee in charge can invite new agents.
          </p>
        )}
      </main>
    </>
  );
}
