import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireOfficePage } from "@/lib/data/current-profile";
import { officeManagersOf } from "@/lib/data/office-manager";
import { officeManagerWording } from "@/lib/office-manager/card";
import { TeamOfficeManagerControls } from "@/components/office-manager/TeamOfficeManagerControls";
import { formatAuTimestamp } from "@/lib/format-date";
import { InviteAgentForm } from "@/components/team/InviteAgentForm";
import { inviteOptions } from "@/lib/team/invite-options";
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
  // The licensee, or an office manager they approved (0093). A typed address
  // refuses anyone else, not just a hidden link (Adam, 7 Oct 2026).
  const { profile, access } = await requireOfficePage();
  const supabase = await createClient();

  const [{ data: staffRows }, { data: inviteRows }, { data: linkRows }, managers, { data: agencyRow }, licenseeLogin] =
    await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: true }),
      supabase.from("agency_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      // Who supports whom. Read once for the whole page rather than per row.
      supabase.from("assistant_agents").select("assistant_id, agent_id"),
      officeManagersOf(supabase, profile.agency_id),
      supabase.from("agencies").select("name, licensee_name, licensee_email, pm_enabled").eq("id", profile.agency_id).maybeSingle(),
      supabase.rpc("office_has_active_licensee"),
    ]);
  const agency = agencyRow as {
    name: string;
    licensee_name: string | null;
    licensee_email: string | null;
    pm_enabled: boolean | null;
  } | null;
  const officeName = (agency?.name ?? "").trim();
  // The licensee manages everyone; an office manager everyone but a licensee
  // in charge (0093). Making or withdrawing an office manager is the
  // licensee's alone, and not on an agent plan.
  const isLicensee = Boolean(profile.is_licensee_in_charge);
  const mayManagePeople = isLicensee || access.isOfficeManager;
  const mayAppoint = isLicensee && !access.isAgentPlan;
  const currentManager = (id: string) => managers.find((m) => m.profile_id === id && m.withdrawn_at === null) ?? null;
  const licenseeHasLogin = !licenseeLogin.error && licenseeLogin.data === true;
  const myApproval = currentManager(profile.id);

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
  const licenseeOnTeam = staff.find((s) => s.is_licensee_in_charge && !s.archived_at) ?? null;
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

        {/* The licensee's details (licensee in charge, their email, the agency
            website) moved to Office profile in Profile settings, with the
            office's names (brief, 14 Oct 2026, Part 6). A pointer stays here,
            where people looked for them. */}
        {/* An office manager: who the licensee is, and the approval that
            lets them run the office. */}
        {access.isOfficeManager && (
          <section aria-label="Licensee in charge" className="mt-6 rounded-card border border-rc-border bg-white p-4 text-sm shadow-card">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Licensee in charge</h2>
            {licenseeHasLogin ? (
              licenseeOnTeam && (
                <p className="mt-2 text-rc-ink">
                  <span className="font-semibold">{licenseeOnTeam.full_name?.trim() || licenseeOnTeam.email}</span>
                  <span className="text-rc-muted"> · {licenseeOnTeam.email} · Signs in RealComply.</span>
                </p>
              )
            ) : (
              <p className="mt-2 text-rc-ink">
                <span className="font-semibold">{agency?.licensee_name?.trim() || "Not recorded"}</span>
                {agency?.licensee_email ? <span className="text-rc-muted"> · {agency.licensee_email}</span> : null}
                <span className="text-rc-muted"> · Not on RealComply. Signs by email link.</span>
              </p>
            )}
            {myApproval && (
              <p className="mt-2 leading-relaxed text-rc-muted">
                You&rsquo;re office manager. {myApproval.approved_by_name} approved this{" "}
                {myApproval.approved_via === "email_link" ? "by email link" : "in Team"} on{" "}
                {formatAuTimestamp(myApproval.approved_at)}.{" "}
                <Link href="/dashboard/document-signoffs#office-managers" className="font-semibold text-rc-green-deep hover:underline">
                  See it in Sign-offs
                </Link>
              </p>
            )}
          </section>
        )}

        {access.actsAsLicensee && (
          <p className="mt-6 rounded-card border border-rc-border bg-white p-4 text-sm text-rc-muted shadow-card">
            The licensee in charge, their email and your agency website are in{" "}
            <Link href="/dashboard/profile" className="font-semibold text-rc-green-deep hover:underline">
              Office profile
            </Link>
            , with your trading name and licensed entity name.
          </p>
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
                  isPropertyManager: s.is_property_manager === true,
                  archivedAt: s.archived_at ?? null,
                }}
                isSelf={s.id === profile.id}
                canManage={mayManagePeople && (isLicensee || !s.is_licensee_in_charge)}
                isOfficeManager={Boolean(currentManager(s.id))}
                offerPropertyManager={agency?.pm_enabled === true}
                officeManagerControls={
                  mayAppoint && s.id !== profile.id && !s.is_licensee_in_charge ? (
                    <TeamOfficeManagerControls
                      personId={s.id}
                      personName={s.full_name?.trim() || s.email}
                      wording={officeManagerWording(s.full_name?.trim() || s.email, officeName)}
                      current={(() => {
                        const m = currentManager(s.id);
                        return m
                          ? {
                              approvedAt: m.approved_at,
                              approvedByName: m.approved_by_name,
                              viaLink: m.approved_via === "email_link",
                              byMe: m.approved_by === profile.id,
                            }
                          : null;
                      })()}
                    />
                  ) : null
                }
                agents={agents.filter((a) => a.id !== s.id).map((a) => ({ id: a.id, name: a.full_name ?? a.email }))}
                supporting={links.filter((l) => l.assistant_id === s.id).map((l) => l.agent_id)}
                subtitle={s.is_assistant ? supportLine(s.id) ?? s.email : s.email}
              />
            ))}
          </ul>
        </div>

        <PendingInvitesList
          invites={invites}
          canManage={mayManagePeople}
          approvedByName={(id) => staff.find((p) => p.id === id)?.full_name?.trim() || null}
        />

        {mayManagePeople ? (
          <div className="mt-6">
            <InviteAgentForm
              agents={agents}
              options={inviteOptions({
                isLicensee,
                isOfficeManager: access.isOfficeManager,
                isAgentPlan: access.isAgentPlan,
                officeHasLicenseeLogin: licenseeHasLogin,
                pmEnabled: agency?.pm_enabled === true,
                licenseeName: agency?.licensee_name ?? null,
                licenseeEmail: agency?.licensee_email ?? null,
              })}
              officeName={officeName}
              licensee={{ name: agency?.licensee_name ?? null, email: agency?.licensee_email ?? null }}
            />
          </div>
        ) : (
          <p className="mt-6 flex items-center gap-1.5 text-xs text-rc-faint">
            <Users size={13} /> Only the licensee in charge can invite people or change who an assistant supports.
          </p>
        )}

        {/* Who has been office manager, approved by whom, how and when, and
            any withdrawal: the record (0093). */}
        {managers.length > 0 && (
          <div className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Office manager record</h3>
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white text-sm shadow-card">
              {managers.flatMap((m) => {
                const lines = [
                  {
                    key: `${m.id}-a`,
                    at: m.approved_at,
                    text: `${m.person_name} made office manager by ${m.approved_by_name}, ${
                      m.approved_via === "email_link" ? "by email link" : "in Team"
                    }: “${m.wording}”`,
                  },
                ];
                if (m.withdrawn_at) {
                  lines.unshift({
                    key: `${m.id}-w`,
                    at: m.withdrawn_at,
                    text:
                      m.withdrawn_via === "left_office"
                        ? `${m.person_name} left the office, so is no longer office manager.`
                        : `${m.person_name}'s office manager approval withdrawn by ${m.withdrawn_by_name ?? "the licensee"}, ${
                            m.withdrawn_via === "email_link" ? "by email link" : "in Team"
                          }.`,
                  });
                }
                return lines;
              }).map((l) => (
                <li key={l.key} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
                  <span className="shrink-0 text-rc-muted sm:w-44">{formatAuTimestamp(l.at)}</span>
                  <span className="min-w-0 break-words text-rc-ink">{l.text}</span>
                </li>
              ))}
            </ul>
            {!isLicensee && (
              <p className="mt-2 text-xs text-rc-faint">Only the licensee in charge can make someone office manager or withdraw it.</p>
            )}
          </div>
        )}
      </main>
    </>
  );
}
