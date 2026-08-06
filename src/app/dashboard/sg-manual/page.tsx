import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { SgManualUploader } from "@/components/registers/SgManualUploader";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Profile, SgManualVersion } from "@/lib/types";

// SG Manual store — simple upload + version history (see the SG Manual
// scope decision: the full AI gap-analysis/redline review flow from the
// mockup is a deliberate later build). Current version = most recent row.
export default async function SgManualPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: versionRows }, { data: staffRows }] = await Promise.all([
    supabase.from("sg_manual_versions").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*"),
  ]);

  const versions = (versionRows ?? []) as SgManualVersion[];
  const staff = (staffRows ?? []) as Profile[];
  const nameFor = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "Unknown" : "Unknown");

  const signedUrls = await Promise.all(
    versions.map((v) => supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(v.file_path, 3600)),
  );

  const current = versions[0];

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-rc-ink">Supervision Guidelines Manual</h1>
            <p className="mt-1 text-sm text-neutral-500">Upload and keep the current version on file, with history.</p>
          </div>
          <Link href="/dashboard/registers" className="text-sm text-neutral-500 hover:underline">
            ← Registers
          </Link>
        </div>

        {current && (
          <div className="mt-6 rounded-lg border border-rc-green-deep/30 bg-rc-green/10 px-4 py-3 text-sm">
            <p className="font-medium text-rc-green-deep">
              Current version{current.version_label ? `: ${current.version_label}` : ""}
            </p>
            <p className="mt-1 text-neutral-600">
              {signedUrls[0]?.data?.signedUrl ? (
                <a href={signedUrls[0].data.signedUrl} target="_blank" rel="noopener noreferrer" className="text-rc-green-deep hover:underline">
                  📎 {current.file_name}
                </a>
              ) : (
                current.file_name
              )}{" "}
              · uploaded {new Date(current.created_at).toLocaleDateString("en-AU")} by {nameFor(current.uploaded_by)}
            </p>
            {current.notes && <p className="mt-1 text-xs text-neutral-500">{current.notes}</p>}
          </div>
        )}

        {profile.is_licensee_in_charge ? (
          <div className="mt-6">
            <SgManualUploader profile={profile} isFirstUpload={versions.length === 0} />
          </div>
        ) : (
          <p className="mt-6 text-xs text-neutral-400">Only the licensee in charge can publish a new version.</p>
        )}

        {versions.length > 1 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-rc-ink">Version history</h2>
            <ul className="mt-2 divide-y divide-rc-border rounded-lg border border-rc-border">
              {versions.slice(1).map((v, i) => {
                const url = signedUrls[i + 1]?.data?.signedUrl ?? null;
                return (
                <li key={v.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-rc-ink">{v.version_label ?? "Untitled version"}</span>
                    <span className="text-xs text-neutral-400">{new Date(v.created_at).toLocaleDateString("en-AU")}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-rc-green-deep hover:underline">
                        {v.file_name}
                      </a>
                    ) : (
                      v.file_name
                    )}{" "}
                    · {nameFor(v.uploaded_by)}
                  </p>
                  {v.notes && <p className="mt-1 text-xs text-neutral-400">{v.notes}</p>}
                </li>
                );
              })}
            </ul>
          </div>
        )}

        {versions.length === 0 && (
          <p className="mt-4 text-sm text-neutral-500">No version uploaded yet.</p>
        )}
      </main>
    </>
  );
}
