import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { AnnexureText } from "@/components/annexure/AnnexureText";
import { requireAccess } from "@/lib/data/current-profile";
import { createClient } from "@/lib/supabase/server";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { SG_ANNEXURE_VERSION, annexureDate } from "@/lib/legal/sg-annexure";
import { officeAdoption } from "@/lib/sg-annexure/office-read";

// The annexure, read only, for everyone in an office (brief, 14 Oct 2026):
// the version their licensee in charge adopted, under the office's logo, with
// who adopted it and when. Linked from the agent welcome email and the Home
// card that asks agents to read it. Not the licensee's signed PDF, which stays
// the licensee's (Registers, Document sign-offs).
//
// An agent on their own plan has no office adoption, so the page is not
// theirs: Home instead.

export const metadata = { title: "The annexure · RealComply" };

export default async function OfficeAnnexurePage() {
  const { profile, access } = await requireAccess();
  if (access.worksAsAgentPlan) redirect("/dashboard/home");

  const supabase = await createClient();
  const [{ data: agencyRow }, adoption] = await Promise.all([
    supabase.from("agencies").select("name, logo_path").eq("id", profile.agency_id).maybeSingle(),
    officeAdoption(supabase),
  ]);
  const agency = agencyRow as { name: string | null; logo_path: string | null } | null;
  const agencyName = agency?.name?.trim() || "Your agency";

  // The logo is the office's own brand folder, which everyone in the office
  // may read. A logo that won't load never stops the page.
  let logo: string | null = null;
  if (agency?.logo_path) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(agency.logo_path, 3600);
    logo = data?.signedUrl ?? null;
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={`${agencyName} logo`} className="max-h-12 max-w-[200px] object-contain" />
      ) : (
        <Logo size={20} />
      )}

      <h1 className="mt-6 text-2xl font-bold tracking-tight text-rc-ink">The RealComply annexure</h1>
      <p className="mt-1.5 max-w-[62ch] text-base text-rc-muted">
        The annexure to {agencyName}&rsquo;s Supervision Guidelines. It records how your agency uses RealComply within
        its supervision system.
      </p>

      {adoption ? (
        <dl className="mt-5 grid gap-x-6 gap-y-1.5 rounded-card border border-rc-border bg-white p-4 text-sm shadow-card sm:grid-cols-[auto_1fr]">
          <dt className="text-rc-muted">Adopted by</dt>
          <dd className="font-semibold text-rc-ink">{adoption.adoptedByName}, licensee in charge</dd>
          <dt className="text-rc-muted">Date adopted</dt>
          <dd className="font-semibold text-rc-ink">{annexureDate(adoption.adoptedAt)}</dd>
          <dt className="text-rc-muted">Version</dt>
          <dd className="font-semibold text-rc-ink">{adoption.version}</dd>
        </dl>
      ) : (
        <p className="mt-5 rounded-card border border-rc-border bg-white p-4 text-sm text-rc-muted shadow-card">
          Your licensee in charge hasn&rsquo;t adopted the annexure yet. This is the annexure as RealComply provides it.
        </p>
      )}
      {adoption && adoption.version !== SG_ANNEXURE_VERSION && (
        <p className="mt-2 text-sm text-rc-muted">
          Shown below is version {SG_ANNEXURE_VERSION}, the current one. Your office adopted version {adoption.version}.
        </p>
      )}

      <div
        tabIndex={0}
        aria-label="The annexure"
        className="mt-6 rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-6"
      >
        <AnnexureText />
      </div>

      <p className="mt-6 text-sm">
        <Link href="/dashboard/sg-manual" className="font-semibold text-rc-green-deep hover:underline">
          Read your Supervision Guidelines
        </Link>
        <span className="text-rc-muted"> · </span>
        <Link href="/dashboard/home" className="font-semibold text-rc-green-deep hover:underline">
          Back to Home
        </Link>
      </p>
    </main>
  );
}
