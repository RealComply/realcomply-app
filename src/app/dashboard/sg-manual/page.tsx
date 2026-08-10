import Link from "next/link";
import { Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { TopNav } from "@/components/TopNav";
import { SgManualUploader } from "@/components/registers/SgManualUploader";
import { DocumentSignoffCard } from "@/components/registers/DocumentSignoffCard";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Profile, SgManualVersion, SignoffDocument, SignoffSignature } from "@/lib/types";

// SG Manual store — simple upload + version history (see the SG Manual
// scope decision: the full AI gap-analysis/redline review flow from the
// mockup is a deliberate later build). Current version = most recent row.
// Every version also publishes a sign-off document (addSgManualVersion in
// registers.ts) so staff can acknowledge it right here, not just from the
// full Document sign-offs register.
export default async function SgManualPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: versionRows }, { data: staffRows }, { data: signoffDocRows }, { data: signoffSigRows }] = await Promise.all([
    supabase.from("sg_manual_versions").select("*").order("created_at", { ascending: false }),
    supabase.from("profiles").select("*"),
    supabase.from("signoff_documents").select("*").eq("category", "sg_manual").order("created_at", { ascending: false }),
    supabase.from("signoff_signatures").select("*"),
  ]);

  const versions = (versionRows ?? []) as SgManualVersion[];
  const staff = (staffRows ?? []) as Profile[];
  const nameFor = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? staff.find((s) => s.id === id)?.email ?? "Unknown" : "Unknown");

  const signedUrls = await Promise.all(
    versions.map((v) => supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(v.file_path, 3600)),
  );

  const current = versions[0];

  // Matched by file_path rather than a formal FK — the signoff row is
  // created from the same upload, in the same request, right after this one.
  const signoffDocs = (signoffDocRows ?? []) as SignoffDocument[];
  const signoffSigs = (signoffSigRows ?? []) as SignoffSignature[];
  const currentSignoff = current ? signoffDocs.find((d) => d.file_path === current.file_path) : undefined;
  const currentSignoffUrl = currentSignoff ? signedUrls[versions.findIndex((v) => v.file_path === currentSignoff.file_path)]?.data?.signedUrl ?? null : null;

  return (
    <>
      <TopNav profile={profile} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Supervision Guidelines Manual</h1>
            <p className="mt-1 text-sm text-rc-muted">Upload and keep the current version on file, with history.</p>
          </div>
          <Link href="/dashboard/registers" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            ← Registers
          </Link>
        </div>

        {current && (
          <div className="mt-6 rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-4 py-3 text-sm shadow-card">
            <p className="font-medium text-rc-green-deep">
              Current version{current.version_label ? `: ${current.version_label}` : ""}
            </p>
            <p className="mt-1 text-rc-muted">
              {signedUrls[0]?.data?.signedUrl ? (
                <a href={signedUrls[0].data.signedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-rc-green-deep hover:underline">
                  <Paperclip size={12} /> {current.file_name}
                </a>
              ) : (
                current.file_name
              )}{" "}
              · uploaded {new Date(current.created_at).toLocaleDateString("en-AU")} by {nameFor(current.uploaded_by)}
            </p>
            {current.notes && <p className="mt-1 text-xs text-rc-muted">{current.notes}</p>}
          </div>
        )}

        {currentSignoff && (
          <div className="mt-4">
            <DocumentSignoffCard
              document={currentSignoff}
              signatures={signoffSigs.filter((s) => s.document_id === currentSignoff.id)}
              profiles={staff}
              currentProfile={profile}
              fileUrl={currentSignoffUrl}
            />
            <Link href="/dashboard/document-signoffs" className="mt-1 inline-block text-xs text-rc-muted transition hover:text-rc-green-deep hover:underline">
              View all sign-offs →
            </Link>
          </div>
        )}

        {profile.is_licensee_in_charge ? (
          <div className="mt-6">
            <SgManualUploader profile={profile} isFirstUpload={versions.length === 0} />
          </div>
        ) : (
          <p className="mt-6 text-xs text-rc-faint">Only the licensee in charge can publish a new version.</p>
        )}

        {versions.length > 1 && (
          <div className="mt-8">
            <h2 className="text-sm font-semibold text-rc-ink">Version history</h2>
            <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white shadow-card">
              {versions.slice(1).map((v, i) => {
                const url = signedUrls[i + 1]?.data?.signedUrl ?? null;
                return (
                <li key={v.id} className="px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-rc-ink">{v.version_label ?? "Untitled version"}</span>
                    <span className="text-xs text-rc-faint">{new Date(v.created_at).toLocaleDateString("en-AU")}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-rc-muted">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-rc-green-deep hover:underline">
                        {v.file_name}
                      </a>
                    ) : (
                      v.file_name
                    )}{" "}
                    · {nameFor(v.uploaded_by)}
                  </p>
                  {v.notes && <p className="mt-1 text-xs text-rc-faint">{v.notes}</p>}
                </li>
                );
              })}
            </ul>
          </div>
        )}

        {versions.length === 0 && (
          <p className="mt-4 text-sm text-rc-muted">No version uploaded yet.</p>
        )}
      </main>
    </>
  );
}
