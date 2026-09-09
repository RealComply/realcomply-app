import { notFound } from "next/navigation";
import { KeyRound, Users, Building2, Ticket } from "lucide-react";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { formatAuDate } from "@/lib/format-date";
import { FounderInvites, type FounderInvite } from "@/components/admin/FounderInvites";

// Who is on RealComply — the only screen that looks across every agency.
//
// Adam, 9 Sep 2026: "how can I easily find anyone who has signed up to a
// working account?"
//
// He could already answer it, in the SQL editor, which is a fine way to ask a
// question once and a bad way to ask it every day while testers trickle in.
// This is the same three questions as who-can-get-in.sql, on a page.
//
// WHY IT NEEDS THE SERVICE KEY, and why that is the dangerous part. Every table
// in this product is scoped by current_agency_id() — that is the whole tenancy
// model, and it means an ordinary query here would return Cass Property and
// nothing else no matter who is asking. Looking across agencies requires
// bypassing row-level security, which is exactly the thing RLS exists to stop.
//
// So the check comes FIRST and the client is created SECOND. Nothing on this
// page is fetched until is_platform_admin has been read from the caller's own
// profile. Getting that order wrong would turn a staff page into a way for any
// signed-in agent to read every agency in the system.
//
// notFound() rather than a redirect, deliberately. A page that redirects tells
// you it exists and you are not allowed in; a 404 tells you nothing. There is
// no reason for a customer to learn this URL is real.
//
// NOT A GENERAL ADMIN CONSOLE, and it should not become one. It reads. Anything
// that CHANGES another agency — comping, suspending, deleting — is a different
// kind of screen with a different standard of care, and there is exactly one
// agency today that anybody would want to change.

export const dynamic = "force-dynamic";

type AgencyRow = {
  id: string;
  name: string;
  status: string;
  plan: string;
  created_at: string;
  comped_reason: string | null;
};

type ProfileRow = {
  id: string;
  agency_id: string;
  full_name: string | null;
  email: string | null;
  is_licensee_in_charge: boolean | null;
  is_platform_admin: boolean | null;
  created_at: string | null;
};

type InviteRow = {
  token: string;
  label: string;
  accepted_at: string | null;
  expires_at: string;
  agency_id: string | null;
};

export default async function AdminPage() {
  const profile = await requireProfile();

  // Before anything is read. See the note above — this ordering is the
  // security property, not a formality.
  if (profile.is_platform_admin !== true) {
    notFound();
  }

  const supabase = createServiceClient();

  const [
    { data: agencyRows },
    { data: profileRows },
    { data: inviteRows },
    { data: propertyRows },
    { data: expiredRows },
  ] = await Promise.all([
      supabase
        .from("agencies")
        .select("id, name, status, plan, created_at, comped_reason")
        .order("created_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, agency_id, full_name, email, is_licensee_in_charge, is_platform_admin, created_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("founder_invites")
        .select("token, label, accepted_at, expires_at, agency_id")
        .order("label", { ascending: true }),
      // Activity, not just existence. An agency that signed up and never added
      // a listing has not tested anything, and that is the single most useful
      // thing to know about a tester — it is the difference between "they are
      // in" and "they are using it".
      supabase.from("properties").select("id, agency_id, created_at"),
      // Expiry decided by the database's clock — see the note below.
      supabase.from("founder_invites").select("token").lt("expires_at", "now()"),
    ]);

  const agencies = (agencyRows ?? []) as AgencyRow[];
  const profiles = (profileRows ?? []) as ProfileRow[];
  const invites = (inviteRows ?? []) as InviteRow[];
  const properties = (propertyRows ?? []) as Array<{ id: string; agency_id: string; created_at: string }>;

  const peopleIn = (agencyId: string) => profiles.filter((p) => p.agency_id === agencyId);
  const listingsIn = (agencyId: string) => properties.filter((p) => p.agency_id === agencyId);

  // Which invites have expired, answered by Postgres rather than by this
  // machine's clock. Two reasons, and the second is the real one. The linter
  // objects to Date.now() during render, correctly — but more importantly, the
  // clock that decides whether a link still works is the database's, because
  // that is where bootstrap_agency_v3 compares expires_at when the link is
  // actually used. Anything else can disagree with the thing that decides.
  const expiredTokens = new Set(
    ((expiredRows ?? []) as Array<{ token: string }>).map((r) => r.token),
  );

  const inviteList: FounderInvite[] = invites.map((invite) => ({
    token: invite.token,
    label: invite.label,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    agencyName: agencies.find((a) => a.id === invite.agency_id)?.name ?? null,
    expired: expiredTokens.has(invite.token),
  }));

  const unusedInvites = inviteList.filter((i) => !i.acceptedAt && !i.expired);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rc-red">
        <KeyRound size={13} aria-hidden="true" />
        RealComply staff
      </p>
      <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-rc-ink">Who&rsquo;s on RealComply</h1>
      <p className="mt-1.5 text-sm text-rc-muted">
        Every agency and every person, across the whole product. Only you can see this page.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat icon={<Building2 size={14} />} label="Agencies" value={agencies.length} />
        <Stat icon={<Users size={14} />} label="People" value={profiles.length} />
        <Stat icon={<Ticket size={14} />} label="Invites left" value={unusedInvites.length} />
      </div>

      {/* AGENCIES, oldest first — so Cass stays at the top and each new tester
          appears underneath in the order they arrived, which is the order the
          question is usually asked in. */}
      <h2 className="mt-9 text-sm font-bold text-rc-ink">Agencies</h2>
      <div className="mt-3 space-y-3">
        {agencies.map((agency) => {
          const people = peopleIn(agency.id);
          const listings = listingsIn(agency.id);
          return (
            <section key={agency.id} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-rc-ink">{agency.name}</p>
                <p className="text-xs text-rc-muted">
                  Joined {formatAuDate(agency.created_at.slice(0, 10))}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-rc-muted">
                {agency.status === "comped" ? "Free account" : agency.status} · {agency.plan} ·{" "}
                {listings.length === 0 ? (
                  // Named plainly rather than shown as a zero. A tester who has
                  // not added a listing has not tested anything, and that is
                  // the thing worth chasing.
                  <span className="font-semibold text-rc-amber-deep">no listings yet</span>
                ) : (
                  `${listings.length} listing${listings.length === 1 ? "" : "s"}`
                )}
              </p>

              <ul className="mt-3 divide-y divide-rc-border border-t border-rc-border">
                {people.length === 0 && (
                  <li className="py-2 text-xs text-rc-muted">
                    No people — an agency row with nobody in it, which shouldn&rsquo;t happen. Tell me if you
                    see this.
                  </li>
                )}
                {people.map((person) => (
                  <li key={person.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="text-sm text-rc-ink">
                      {person.full_name || "(no name)"}{" "}
                      <span className="text-xs text-rc-muted">{person.email}</span>
                    </span>
                    <span className="text-xs font-medium text-rc-muted">
                      {person.is_platform_admin ? "RealComply staff · " : ""}
                      {person.is_licensee_in_charge ? "Licensee in charge" : "Agent"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* INVITES. Making one lives here rather than in Team settings, which is
          where Adam went looking and where the only invite button puts somebody
          INSIDE this agency — see the note in lib/actions/founder-invites.ts. */}
      <h2 className="mt-9 text-sm font-bold text-rc-ink">Founder invites</h2>
      <p className="mt-1 text-xs text-rc-muted">
        Each link works once and creates one new agency. Signups stay closed to everyone else. Not the same
        as a Team invite, which adds someone to <em>this</em> agency.
      </p>

      <div className="mt-3">
        <FounderInvites invites={inviteList} siteUrl={siteUrl} />
      </div>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-3 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-rc-faint">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-rc-ink">{value}</p>
    </div>
  );
}
