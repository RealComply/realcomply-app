import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { pmAgencySettings } from "@/lib/data/pm";
import { agencyLogoUrl } from "@/lib/storage/evidence";
import { AgencyLogoForm } from "@/components/team/AgencyLogoForm";
import { LogoMark } from "@/components/Logo";
import { roleLabel } from "@/components/UserBar";

// Profile settings, from the picture top right (Adam, 12 Oct 2026: "if you
// click on the agent's icon in the top right corner, there should be an option
// there for profile settings where you have your company logo").
//
// Every signed-in person can open it. The logo upload is the licensee in
// charge's, the same as set_agency_logo (0030); anyone else in an office sees
// the logo their licensee set. The rest of the office's details are set up at
// the start and changed where they are used, so this page links to them
// rather than repeating them.

export default async function ProfileSettingsPage() {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  const [{ data: agencyRow }, pm] = await Promise.all([
    supabase.from("agencies").select("name, logo_path").eq("id", profile.agency_id).maybeSingle(),
    pmAgencySettings(supabase, profile.agency_id),
  ]);
  const agency = agencyRow as { name?: string | null; logo_path?: string | null } | null;
  const agencyName = agency?.name ?? "Your agency";
  const logoPath = agency?.logo_path ?? null;
  const logoUrl = await agencyLogoUrl(supabase, logoPath);

  const officeDetails = [
    { label: "Licensee name and email, agency website", where: "Team", href: "/dashboard/team" },
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

      {profile.is_licensee_in_charge ? (
        <section className="mt-6 grid gap-5 md:grid-cols-2">
          <AgencyLogoForm currentPath={logoPath} currentUrl={logoUrl} />
          <WhereItShows agencyName={agencyName} logoUrl={logoUrl} />
        </section>
      ) : (
        logoUrl && (
          <section className="mt-6 rounded-card border border-rc-border bg-white p-4 shadow-card">
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
function WhereItShows({ agencyName, logoUrl }: { agencyName: string; logoUrl: string | null }) {
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
            <p className="truncate text-sm font-bold text-rc-ink">{agencyName}</p>
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
