import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { pmAgencySettings } from "@/lib/data/pm";
import { agencyLogoUrl } from "@/lib/storage/evidence";
import { AgencyLogoForm } from "@/components/team/AgencyLogoForm";
import { LicenseeEmailForm } from "@/components/team/LicenseeEmailForm";
import { OfficeDetailsForm, OfficeNamesReadOnly } from "@/components/profile/OfficeDetailsForm";
import { LogoMark } from "@/components/Logo";
import { roleLabel } from "@/components/UserBar";
import { describeEntityNameChange, formalAgencyName, type NameChangeVia } from "@/lib/agency-names";
import { formatAuTimestamp } from "@/lib/format-date";
import { agencyPeople } from "@/lib/data/people";
import { sydneyDate } from "@/lib/subscription-end/dates";
import {
  currentLicenseeDetails,
  historyRows,
  licenceLabel,
  openLineFor,
  type LicenseeHistoryLine,
} from "@/lib/licensee-history";
import { LicenseeInChargeCard, type Candidate, type HistoryTableRow } from "@/components/profile/LicenseeInChargeCard";

// Profile settings, from the picture top right (Adam, 12 Oct 2026: "if you
// click on the agent's icon in the top right corner, there should be an option
// there for profile settings where you have your company logo").
//
// Every signed-in person can open it. The logo upload is the licensee in
// charge's, the same as set_agency_logo (0030); anyone else in an office sees
// the logo their licensee set.
//
// OFFICE PROFILE (brief, 14 Oct 2026, Parts 1 and 6): the office's trading
// name and licensed entity name, and the licensee in charge, their email and
// the agency website, all editable here at any time by the licensee in charge
// or an agent on their own plan. Sign-up, the corporation licence and the
// annexure signing page fill the same record. The licensee's details moved
// here from Team. The office's other details (licence, insurance, gifts, PM)
// are changed where they are used, so this page links to them.
//
// LICENSEE IN CHARGE (0080; mockup approved by Adam, 16 Oct 2026): who the
// office's licensee in charge is, since when and when Fair Trading was told,
// with the history. Office plans only. The current licensee in charge can
// hand the role on from here.

export default async function ProfileSettingsPage() {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  const [{ data: agencyRow }, pm, { data: changeRows }] = await Promise.all([
    supabase
      .from("agencies")
      .select("name, plan, logo_path, licensed_entity_name, licensed_entity_name_source, licensee_name, licensee_email, website_url")
      .eq("id", profile.agency_id)
      .maybeSingle(),
    pmAgencySettings(supabase, profile.agency_id),
    supabase
      .from("agency_name_changes")
      .select("via, changed_by, changed_by_name, changed_at")
      .eq("agency_id", profile.agency_id)
      .eq("name_kind", "licensed_entity")
      .order("changed_at", { ascending: false })
      .limit(1),
  ]);
  const agency = agencyRow as {
    name?: string | null;
    plan?: string | null;
    logo_path?: string | null;
    licensed_entity_name?: string | null;
    licensed_entity_name_source?: string | null;
    licensee_name?: string | null;
    licensee_email?: string | null;
    website_url?: string | null;
  } | null;
  const agencyName = agency?.name ?? "Your agency";
  const entityName = agency?.licensed_entity_name ?? null;
  const logoPath = agency?.logo_path ?? null;
  const logoUrl = await agencyLogoUrl(supabase, logoPath);

  // Who last changed the licensed entity name, and when (0070).
  const last = ((changeRows ?? []) as Array<{
    via: NameChangeVia;
    changed_by: string | null;
    changed_by_name: string | null;
    changed_at: string;
  }>)[0];
  let lastChange: string | null = null;
  if (last && entityName) {
    let who = last.changed_by_name;
    if (!who && last.changed_by) {
      const { data: person } = await supabase.from("profiles").select("full_name").eq("id", last.changed_by).maybeSingle();
      who = (person as { full_name?: string | null } | null)?.full_name ?? null;
    }
    lastChange = describeEntityNameChange(last.via, who, formatAuTimestamp(last.changed_at));
  }

  const licensee = access.isAgentPlan ? null : await licenseeCard(supabase, profile, access.officeLicensee);

  const officeDetails = [
    { label: "Corporation licence", where: "Registers", href: "/dashboard/registers?tab=licence" },
    { label: "PI, cyber and workers insurance", where: "Registers", href: "/dashboard/registers?tab=insurance" },
    { label: "Gift disclosure threshold", where: "Registers", href: "/dashboard/registers?tab=gifts" },
    ...(pm.enabled
      ? [{ label: "Property management records system", where: "Property management", href: "/dashboard/pm" }]
      : []),
  ];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Profile settings</h1>
      <p className="mt-1 text-sm text-rc-muted">Your details, and how your agency appears in RealComply.</p>

      <section className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-rc-faint">Office profile</h2>
        <div className="mt-2 space-y-5">
          {access.actsAsLicensee ? (
            <>
              <OfficeDetailsForm
                tradingName={agencyName}
                licensedEntityName={entityName}
                fromLicence={agency?.licensed_entity_name_source === "licence"}
                lastChange={lastChange}
              />
              <LicenseeEmailForm
                current={agency?.licensee_email ?? null}
                currentName={agency?.licensee_name ?? null}
                website={agency?.website_url ?? null}
              />
            </>
          ) : (
            <OfficeNamesReadOnly tradingName={agencyName} licensedEntityName={entityName} />
          )}
          {licensee && <LicenseeInChargeCard {...licensee} />}
        </div>
      </section>

      {profile.is_licensee_in_charge ? (
        <section className="mt-5 grid gap-5 md:grid-cols-2">
          <AgencyLogoForm currentPath={logoPath} currentUrl={logoUrl} />
          <WhereItShows
            recordName={formalAgencyName({ tradingName: agencyName, licensedEntityName: entityName })}
            logoUrl={logoUrl}
          />
        </section>
      ) : (
        logoUrl && (
          <section className="mt-5 rounded-card border border-rc-border bg-white p-4 shadow-card">
            <p className="text-sm font-medium text-rc-ink">Agency logo</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={`${agencyName} logo`} className="mt-3 max-h-12 max-w-[200px] object-contain" />
            <p className="mt-2 text-xs text-rc-muted">Your licensee in charge looks after this.</p>
          </section>
        )
      )}

      <section className="mt-5 rounded-card border border-rc-border bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-rc-ink">Your details</h2>
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold text-rc-muted">Name</dt>
            <dd className="mt-0.5 text-sm font-semibold text-rc-ink">{profile.full_name ?? "Not set"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-semibold text-rc-muted">Email</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-rc-ink">{profile.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-rc-muted">Role</dt>
            <dd className="mt-0.5 text-sm font-semibold text-rc-ink">{roleLabel(profile)}</dd>
          </div>
        </dl>
        <Link
          href="/dashboard/password"
          className="mt-4 inline-block text-sm font-semibold text-rc-green-deep hover:underline"
        >
          Change password
        </Link>
      </section>

      {access.actsAsLicensee && (
        <section className="mt-5 rounded-card border border-rc-border bg-white p-5 shadow-card">
          <h2 className="text-base font-bold text-rc-ink">Your office&rsquo;s other details</h2>
          <p className="mt-1 text-sm text-rc-muted">Set up when you joined. Change them where they&rsquo;re used:</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {officeDetails.map((d) => (
              <li key={d.label}>
                <Link
                  href={d.href}
                  className="flex items-center justify-between gap-3 rounded-xl border border-rc-border px-3.5 py-3 text-sm font-semibold text-rc-ink transition hover:border-rc-green-deep/40 hover:bg-rc-bg-alt"
                >
                  <span>{d.label}</span>
                  <span className="shrink-0 font-medium text-rc-muted">{d.where}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** The two places the logo appears, drawn small, so it can be judged before anyone else sees it. */
function WhereItShows({
  recordName,
  logoUrl,
}: {
  /** "X trading as Y" when the office has a licensed entity name (0070). */
  recordName: string;
  logoUrl: string | null;
}) {
  const logo = logoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className="max-h-7 max-w-[140px] object-contain" />
  ) : (
    <span className="rounded-md border border-dashed border-rc-border px-3 py-1 text-xs text-rc-faint">Your logo</span>
  );

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <p className="text-xs font-bold uppercase tracking-wide text-rc-faint">Where it shows</p>

      <p className="mt-3 text-xs font-semibold text-rc-ink">The top of the menu, for everyone in your office</p>
      <div className="mt-2 w-[236px] max-w-full rounded-xl bg-rc-nav-bg p-3">
        <div className="flex items-center gap-2 px-1 pb-2.5">
          <LogoMark size={24} variant="dark" />
          <span className="text-[15px] font-extrabold tracking-tight text-white">
            Real<span className="text-rc-green">Comply</span>
          </span>
        </div>
        <div className="flex h-10 items-center rounded-lg bg-white px-2.5">{logo}</div>
      </div>

      <p className="mt-4 text-xs font-semibold text-rc-ink">The top of every compliance record</p>
      <div className="mt-2 rounded-lg border border-rc-border border-t-4 border-t-rc-green-deep bg-white p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-rc-ink">{recordName}</p>
            <p className="text-[11px] text-rc-muted">Finalised compliance record</p>
          </div>
          {logo}
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-rc-border pt-2">
          <LogoMark size={14} />
          <span className="text-[11px] font-extrabold tracking-tight text-rc-ink">
            Real<span className="text-rc-green-deep">Comply</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * What the "Licensee in charge" card shows (0080). Null when the history
 * can't be read (before 0080 has run) or holds nothing for this office.
 */
async function licenseeCard(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profile: { id: string; agency_id: string },
  officeLicensee: boolean,
): Promise<React.ComponentProps<typeof LicenseeInChargeCard> | null> {
  const [{ data: lineRows, error }, people, { data: teamRows }] = await Promise.all([
    supabase
      .from("licensee_in_charge_history")
      .select("*")
      .eq("agency_id", profile.agency_id)
      .order("recorded_at", { ascending: true }),
    agencyPeople(supabase),
    officeLicensee
      ? supabase
          .from("profiles")
          .select("id, full_name, email, licence_type, licence_number, is_assistant, archived_at, is_licensee_in_charge")
          .eq("agency_id", profile.agency_id)
      : Promise.resolve({ data: [] }),
  ]);
  if (error) {
    console.error("licensee_in_charge_history not read:", error.message);
    return null;
  }
  const lines = (lineRows ?? []) as LicenseeHistoryLine[];
  if (lines.length === 0) return null;

  const nameOf: Record<string, string> = {};
  for (const p of people) if (p.full_name) nameOf[p.id] = p.full_name;

  // The current licensee in charge: the viewer's own open line if they are
  // one, else the most recent open line.
  const open = lines.filter((l) => !l.ended_at).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
  const currentLine = openLineFor(lines, profile.id) ?? open[0] ?? null;

  const rows: HistoryTableRow[] = historyRows(lines, nameOf, formatAuTimestamp).map((r) => {
    const line = lines.find((l) => l.id === r.id)!;
    return { ...r, missingStart: !line.started_on, missingFairTrading: !line.fair_trading_told_on };
  });

  type TeamRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    licence_type: string | null;
    licence_number: string | null;
    is_assistant: boolean | null;
    archived_at: string | null;
    is_licensee_in_charge: boolean | null;
  };
  const candidates: Candidate[] = ((teamRows ?? []) as TeamRow[])
    .filter(
      (p) =>
        p.id !== profile.id &&
        !p.archived_at &&
        !p.is_assistant &&
        p.licence_type === "class_1" &&
        Boolean(p.licence_number?.trim()),
    )
    .map((p) => {
      const name = p.full_name?.trim() || p.email || "Team member";
      return { id: p.id, name, label: `${name} (${licenceLabel(p.licence_type, p.licence_number)})` };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-AU"));

  return {
    current: currentLine
      ? {
          lineId: currentLine.id,
          name: currentLine.licensee_name,
          details: currentLicenseeDetails(currentLine),
          startedOn: currentLine.started_on,
          fairTradingToldOn: currentLine.fair_trading_told_on,
        }
      : null,
    rows,
    canChange: officeLicensee,
    candidates,
    todayIso: sydneyDate(new Date()),
  };
}
