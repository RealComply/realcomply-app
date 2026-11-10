import Link from "next/link";
import { agencyPeople } from "@/lib/data/people";
import { Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { SgDocumentUploader } from "@/components/sg/SgDocumentUploader";
import { SgReadingCard } from "@/components/sg/SgReadingCard";
import { SgDraftReview } from "@/components/sg/SgDraftReview";
import { SgReadFailedCard } from "@/components/sg/SgReadFailedCard";
import { SgLiveDocument } from "@/components/sg/SgLiveDocument";
import { sgDocumentsFor } from "@/lib/data/sg-document";
import { sgReadGapLines } from "@/lib/sg-document/checks";
import { DocumentSignoffCard } from "@/components/registers/DocumentSignoffCard";
import { AmlPreCommencementCard } from "@/components/registers/AmlPreCommencementCard";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { notAskedToSign } from "@/lib/signoff/awaiting";
import { staffReminderData } from "@/lib/data/staff-reminders";
import { StaffRemindersCard } from "@/components/registers/StaffRemindersCard";
import type { SgManualVersion, SignoffDocument, SignoffSignature } from "@/lib/types";
import { RoofMark } from "@/components/RoofMark";

// Supervision guidelines and operational procedures (was "SG Manual").
//
// REVERSAL (Adam's mockup, signed off 6 Nov 2026; part 1 built 10 Nov). Was:
// upload a file and keep its version history, nothing read. Now the office's
// document is read into sections, checked against Fair Trading's 2.1.3 and,
// once the licensee in charge or an office manager has checked it, picked the
// kind of document and confirmed the version, saved as the live document
// everyone in the office reads. The 4 manuals already on file are read into
// drafts the same way (Master, 10 Nov 2026: "A"); until one is saved its
// current file stays exactly as it is. Every file still publishes a sign-off
// document so every staff member signs it, as before.
//
// Reading a long document runs past a normal request: the page moves it
// along while it's open (continueSgDocumentRead), within this limit.
export const maxDuration = 300;

export default async function SgManualPage() {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();

  const [{ data: versionRows }, staff, { data: signoffDocRows }, { data: signoffSigRows }, { data: agency }, sg] = await Promise.all([
    supabase.from("sg_manual_versions").select("*").order("created_at", { ascending: false }),
    agencyPeople(supabase),
    supabase.from("signoff_documents").select("*").eq("category", "sg_manual").order("created_at", { ascending: false }),
    supabase.from("signoff_signatures").select("*"),
    supabase.from("agencies").select("aml_precommencement_enabled").eq("id", profile.agency_id).maybeSingle(),
    sgDocumentsFor(supabase),
  ]);
  const open = access.runsOffice ? sg.open : null;

  // Who still needs to sign or read, for the reminder card (0093): the
  // licensee or an office manager only.
  const reminders = access.runsOffice ? (await staffReminderData(supabase, profile)).stillToDo : [];

  const versions = (versionRows ?? []) as SgManualVersion[];
  const nameFor = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? "Unknown" : "Unknown");

  const signedUrls = await Promise.all(
    versions.map((v) => supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(v.file_path, 3600)),
  );

  const current = versions[0];

  // Matched by file_path rather than a formal FK — the signoff row is
  // created from the same upload, in the same request, right after this one.
  const signoffDocs = (signoffDocRows ?? []) as SignoffDocument[];
  const signoffSigs = (signoffSigRows ?? []) as SignoffSignature[];
  const currentSignoff = current ? signoffDocs.find((d) => d.file_path === current.file_path) : undefined;
  const currentSigs = currentSignoff ? signoffSigs.filter((s) => s.document_id === currentSignoff.id) : [];
  // Present staff with no row on the current version (10 Oct 2026): anyone
  // who joined after it was published and before 0060 began adding new
  // starters. Only the licensee reads every row, so only they can tell.
  const notAsked =
    access.runsOffice && currentSignoff?.signer_scope === "all_staff" ? notAskedToSign(staff, currentSigs) : [];
  // The signed copy where there is one, so opening the current version from
  // this page shows the signature page rather than the bare upload. The
  // version list below still links each original.
  const currentSignoffUrl = currentSignoff
    ? currentSignoff.signed_file_path
      ? (await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(currentSignoff.signed_file_path, 3600))
          .data?.signedUrl ?? null
      : signedUrls[versions.findIndex((v) => v.file_path === currentSignoff.file_path)]?.data?.signedUrl ?? null
    : null;

  return (
    <>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Supervision guidelines and operational procedures</h1>
            <p className="mt-1 text-sm text-rc-muted">
              {access.runsOffice
                ? "Your office's own document, read into sections and kept current, with every version on file."
                : "The office's own document and every version on file. The licensee in charge or an office manager publishes new versions."}
            </p>
          </div>
          <Link href="/dashboard/registers" className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
            <RoofMark back />Registers
          </Link>
        </div>

        {open && (
          <div className="mt-6">
            {open.doc.status === "reading" ? (
              <SgReadingCard
                id={open.doc.id}
                fileName={open.doc.fileName}
                done={open.doc.done}
                total={open.doc.total}
                fromFileOnRecord={open.doc.fromFileOnRecord}
              />
            ) : open.doc.status === "draft" ? (
              <SgDraftReview
                id={open.doc.id}
                fileName={open.doc.fileName}
                fromFileOnRecord={open.doc.fromFileOnRecord}
                versionRead={open.doc.versionRead}
                checks={open.doc.checks}
                sections={open.sections}
              />
            ) : (
              <SgReadFailedCard
                id={open.doc.id}
                fileName={open.doc.fileName}
                reason={open.doc.readError}
                fromFileOnRecord={open.doc.fromFileOnRecord}
              />
            )}
          </div>
        )}

        {sg.live && (
          <div className="mt-8">
            <SgLiveDocument
              docType={sg.live.doc.docType}
              versionLabel={sg.live.doc.versionLabel}
              savedAt={sg.live.doc.savedAt}
              savedByName={sg.live.doc.savedByName}
              sections={sg.live.sections}
              canUpload={access.runsOffice}
              gaps={sgReadGapLines(sg.live.doc.checks)}
            />
          </div>
        )}

        {current && (
          <div className="mt-6 rounded-card border border-rc-green-deep/30 bg-rc-green-soft px-4 py-3 text-sm shadow-card">
            <p className="font-medium text-rc-green-deep">
              Current file{current.version_label ? `: ${current.version_label}` : ""}
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
              signatures={currentSigs}
              profiles={staff}
              currentProfile={profile}
              ownOnly={!access.runsOffice}
              fileUrl={currentSignoffUrl}
              notAsked={notAsked}
            />
            <Link href="/dashboard/document-signoffs" className="mt-1 inline-block text-xs text-rc-muted transition hover:text-rc-green-deep hover:underline">
              View all sign-offs<RoofMark />
            </Link>
          </div>
        )}

        {reminders.length > 0 && (
          <StaffRemindersCard
            rows={reminders.map((r) => ({
              id: r.person.id,
              name: r.person.full_name?.trim() || r.person.email,
              kinds: r.kinds,
              lastRemindedAt: r.lastRemindedAt,
            }))}
          />
        )}

        {/* Whoever runs the office: the licensee in charge, an office manager
            (0093), or an agent on their own plan. The database checks the same (0122). */}
        {access.runsOffice ? (
          <div className="mt-6">
            <SgDocumentUploader agencyId={profile.agency_id} hasLive={Boolean(sg.live) || versions.length > 0} />
          </div>
        ) : (
          <p className="mt-6 text-xs text-rc-faint">The licensee in charge or an office manager publishes new versions.</p>
        )}

        {/* The agency's standing positions — things confirmed once here rather
            than re-answered on every file. Sits with the SG because that is
            where the agency's own standard is written down. */}
        <AmlPreCommencementCard
          enabled={Boolean(agency?.aml_precommencement_enabled)}
          isLicensee={profile.is_licensee_in_charge}
        />

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
