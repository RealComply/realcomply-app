import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LicenseeEmailForm } from "@/components/team/LicenseeEmailForm";
import { AgencyLogoForm } from "@/components/team/AgencyLogoForm";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
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
  const agents = staff.filter((s) => s.is_agent);
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
                  <p className="text-xs text-rc-muted">
                    {s.is_assistant ? supportLine(s.id) : s.email}
                  </p>
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
                  {s.is_assistant && (
                    <span className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] font-medium text-rc-green-deep-600">
                      Assistant
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
