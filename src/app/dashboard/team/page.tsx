import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LicenseeEmailForm } from "@/components/team/LicenseeEmailForm";
import { AgencyLogoForm } from "@/components/team/AgencyLogoForm";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { requireProfile } from "@/lib/data/current-profile";
import { InviteAgentForm } from "@/components/team/InviteAgentForm";
import { PendingInvitesList } from "@/components/team/PendingInvitesList";
import { StaffRow } from "@/components/team/StaffRow";
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

  const [{ data: staffRows }, { data: inviteRows }, { data: linkRows }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at", { ascending: true }),
    supabase.from("agency_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }),
    // Who supports whom. Read once for the whole page rather than per row.
    supabase.from("assistant_agents").select("assistant_id, agent_id"),
  ]);

  // Read here rather than in the component so the form is a client component
  // with a plain prop, not another round trip.
  const { data: agencyRow } = await supabase
    .from("agencies")
    .select("licensee_email, licensee_name, website_url, logo_path")
    .eq("id", profile.agency_id)
    .maybeSingle();
  const agencyDetails = agencyRow as { licensee_email?: string | null; licensee_name?: string | null; website_url?: string | null; logo_path?: string | null } | null;
  const licenseeEmail = agencyDetails?.licensee_email ?? null;
  const licenseeName = agencyDetails?.licensee_name ?? null;

  // Signed here rather than in the client component: the bucket is private, and
  // doing it on the server means the form needs no effect and no loading state.
  const logoPath = agencyDetails?.logo_path ?? null;
  const logoUrl = logoPath
    ? (await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(logoPath, 3600)).data?.signedUrl ?? null
    : null;
  const websiteUrl = agencyDetails?.website_url ?? null;

  const staff = (staffRows ?? []) as Profile[];
  const invites = (inviteRows ?? []) as AgencyInvite[];
  const links = (linkRows ?? []) as { assistant_id: string; agent_id: string }[];

  // Only real agents can be supported — an assistant supporting another
  // assistant is meaningless, and the licensee already sees everything.
  // Archived people sink to the bottom: the roster is read to answer "who is
  // here", and someone who left should not sit between two people who haven't.
  staff.sort((a, b) => Number(Boolean(a.archived_at)) - Number(Boolean(b.archived_at)));

  // Only active agents can be supported or moved work to. An archived person
  // cannot sign anything, so offering them is offering a dead end.
  const agents = staff.filter((s) => s.is_agent && !s.archived_at);
  const activeCount = staff.filter((s) => !s.archived_at).length;
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.full_name ?? "someone";

  // "Assistant to Adam Castelnuovo and Sue Nguyen" — the arrangement stated in
  // words, so the licensee can check it at a glance rather than opening a
  // settings panel to find out who can see what.
  function supportLine(assistantId: string): string | null {
    const names = links.filter((l) => l.assistant_id === assistantId).map((l) => nameOf(l.agent_id));
    if (names.length === 0) return "Not attached to any agent yet — they can't see any listings.";
    if (names.length === 1) return `Assistant to ${names[0]}`;
    return `Assistant to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

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
            <LicenseeEmailForm current={licenseeEmail} currentName={licenseeName} website={websiteUrl} />
            <AgencyLogoForm currentPath={agencyDetails?.logo_path ?? null} currentUrl={logoUrl} />
          </div>
        )}

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">
            Staff ({activeCount})
          </h3>
          <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
            {staff.map((s) => (
              <StaffRow
                key={s.id}
                person={{
                  id: s.id,
                  fullName: s.full_name,
                  email: s.email,
                  isAgent: s.is_agent,
                  isAssistant: Boolean(s.is_assistant),
                  isLicensee: s.is_licensee_in_charge,
                  archivedAt: s.archived_at ?? null,
                }}
                isSelf={s.id === profile.id}
                canManage={Boolean(profile.is_licensee_in_charge)}
                agents={agents.filter((a) => a.id !== s.id).map((a) => ({ id: a.id, name: a.full_name ?? a.email }))}
                subtitle={s.is_assistant ? supportLine(s.id) ?? s.email : s.email}
              />
            ))}
          </ul>
        </div>

        <PendingInvitesList invites={invites} canManage={profile.is_licensee_in_charge} />

        {profile.is_licensee_in_charge ? (
          <div className="mt-6">
            <InviteAgentForm agents={agents} />
          </div>
        ) : (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-rc-faint">
            <Users size={13} /> Only the licensee in charge can invite people or change who an assistant supports.
          </p>
        )}
      </main>
    </>
  );
}
