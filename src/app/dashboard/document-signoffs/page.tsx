import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { DocumentSignoffCard } from "@/components/registers/DocumentSignoffCard";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Profile, SignoffDocument, SignoffSignature } from "@/lib/types";

// Document sign-offs — the generic register for "upload a document, the
// right people sign it in RealComply" (Adam, 9 Aug 2026). Currently feeds
// two sources: SG Manual versions (published from the SG Manual page, every
// staff member signs) and trust account reconciliations (uploaded and signed
// on Registers → Trust account since 25 Aug 2026, licensee signs). Both show
// up in the list below. See signoffs.ts and 0009_document_signoffs.sql.
export default async function DocumentSignoffsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: docRows }, { data: sigRows }, { data: staffRows }] = await Promise.all([
    supabase.from("signoff_documents").select("*").order("created_at", { ascending: false }),
    supabase.from("signoff_signatures").select("*"),
    supabase.from("profiles").select("*"),
  ]);

  const documents = (docRows ?? []) as SignoffDocument[];
  const signatures = (sigRows ?? []) as SignoffSignature[];
  const staff = (staffRows ?? []) as Profile[];

  const signedUrls = await Promise.all(
    documents.map((d) => supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(d.file_path, 3600)),
  );

  const outstandingForMe = documents.filter((d) =>
    signatures.some((s) => s.document_id === d.id && s.signer_id === profile.id && !s.signed_at),
  ).length;

  return (
    <>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Document sign-offs</h1>
            <p className="mt-1 text-sm text-rc-muted">
              Documents that need a signature — sign them here, no printing, no external service.
            </p>
          </div>
          <Link href="/dashboard/registers" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            ← Registers
          </Link>
        </div>

        {outstandingForMe > 0 && (
          <div className="mt-6 rounded-card border border-rc-amber/30 bg-rc-amber/10 px-4 py-3 text-sm text-rc-amber-deep">
            You have {outstandingForMe} document{outstandingForMe === 1 ? "" : "s"} waiting on your signature below.
          </div>
        )}

        {/* The uploader that used to sit here has moved to Registers → Trust
            account (25 Aug 2026). It had to: this one asked for the period as
            free text, so nothing could tell which months were missing, and a
            second way in would keep producing undated rows that the calendar
            there cannot place. Signed reconciliations still appear in the list
            below like any other document. */}
        {(profile.is_licensee_in_charge || profile.is_assistant) && (
          <div className="mt-6 rounded-card border border-rc-border bg-rc-bg-alt px-4 py-3 text-sm text-rc-muted">
            Trust account reconciliations are now uploaded and signed on the{" "}
            <Link
              href="/dashboard/registers?tab=trust"
              className="font-medium text-rc-green-deep hover:underline"
            >
              Trust account register
            </Link>
            , which tracks which months are outstanding.
          </div>
        )}

        <div className="mt-8 space-y-4">
          {documents.length === 0 && (
            <p className="text-sm text-rc-muted">
              Nothing here yet. Publishing a new{" "}
              <Link href="/dashboard/sg-manual" className="text-rc-green-deep hover:underline">
                SG Manual version
              </Link>{" "}
              will show up here for sign-off.
            </p>
          )}
          {documents.map((doc, i) => (
            <DocumentSignoffCard
              key={doc.id}
              document={doc}
              signatures={signatures.filter((s) => s.document_id === doc.id)}
              profiles={staff}
              currentProfile={profile}
              fileUrl={signedUrls[i]?.data?.signedUrl ?? null}
            />
          ))}
        </div>
      </main>
    </>
  );
}
