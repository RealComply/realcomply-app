import Link from "next/link";
import { agencyPeople } from "@/lib/data/people";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { DocumentSignoffCard } from "@/components/registers/DocumentSignoffCard";
import { AnnexureAdoptionCard } from "@/components/registers/AnnexureAdoptionCard";
import { FiledRecordCard, when } from "@/components/registers/FiledRecordCard";
import { SgReadConfirmationsCard } from "@/components/registers/SgReadConfirmationsCard";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { documentsWaitingOn, notAskedToSign } from "@/lib/signoff/awaiting";
import { officeManagersOf } from "@/lib/data/office-manager";
import { formatAuTimestamp } from "@/lib/format-date";
import type {
  AgentAcknowledgement,
  SgAnnexureAdoption,
  SgReadConfirmation,
  SignoffDocument,
  SignoffSignature,
} from "@/lib/types";
import { RoofMark } from "@/components/RoofMark";

// Document sign-offs — the generic register for "upload a document, the
// right people sign it in RealComply" (Adam, 9 Aug 2026). Currently feeds
// two sources: SG Manual versions (published from the SG Manual page, every
// staff member signs) and trust account reconciliations (uploaded and signed
// on Registers → Trust account since 25 Aug 2026, licensee signs). Both show
// up in the list below. See signoffs.ts and 0009_document_signoffs.sql.
export default async function DocumentSignoffsPage() {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  // Office manager approvals (0093): who, approved by whom, how, when and the
  // wording. The licensee and the office manager see them; an agent doesn't.
  const officeManagers = access.runsOffice ? await officeManagersOf(supabase, profile.agency_id) : [];

  const [{ data: docRows }, { data: sigRows }, staff, { data: adoptionRows }, { data: readRows }, { data: ackRows }] =
    await Promise.all([
      supabase.from("signoff_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("signoff_signatures").select("*"),
      agencyPeople(supabase),
      // The SG annexure's adoptions (0067). The licensee reads them; anyone else
      // gets none, and never sees the annexure's document either.
      supabase.from("sg_annexure_adoptions").select("*"),
      // Agents' read-and-tick of the annexure and the SG (0069): their own, or
      // the office's for the licensee in charge.
      supabase.from("sg_read_confirmations").select("*"),
      // An agent's own plan's "Before you start" acknowledgement (0071). Empty
      // before 0071 has run.
      supabase.from("agent_acknowledgements").select("*"),
    ]);
  const acknowledgements = (ackRows ?? []) as AgentAcknowledgement[];
  const adoptions = (adoptionRows ?? []) as SgAnnexureAdoption[];
  const readConfirmations = (readRows ?? []) as SgReadConfirmation[];
  const nameOf = (id: string | null) =>
    (id === profile.id ? profile.full_name : staff.find((p) => p.id === id)?.full_name)?.trim() || "A former agent";

  const documents = (docRows ?? []) as SignoffDocument[];
  const signatures = (sigRows ?? []) as SignoffSignature[];

  const signedUrls = await Promise.all(
    // The signed copy where there is one — the document plus its signature
    // page — and the upload otherwise. Same rule as the trust reconciliation
    // dialog: what people want to open is what was signed.
    documents.map((d) =>
      supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(d.signed_file_path ?? d.file_path, 3600),
    ),
  );

  // Not a licensee-only document a fellow licensee has already signed off
  // (10 Oct 2026): it needs one licensee's signature, not each of theirs.
  const outstandingForMe = documentsWaitingOn(
    profile.id,
    signatures,
    new Set(documents.filter((d) => d.signer_scope === "licensee_only").map((d) => d.id)),
  );

  // The current SG Manual version is the newest all-staff one (the one 0060
  // gives new starters a row on). Its card shows the licensee who in the
  // office was never asked to sign it, as the SG Manual page does.
  const currentSg = documents.find((d) => d.category === "sg_manual" && d.signer_scope === "all_staff");
  const notAskedOnCurrentSg =
    access.runsOffice && currentSg
      ? notAskedToSign(staff, signatures.filter((s) => s.document_id === currentSg.id))
      : [];

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
            <RoofMark back />Registers
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
        {(profile.is_licensee_in_charge || access.isOfficeManager) && (
          <div className="mt-6 rounded-card border border-rc-border bg-rc-bg-alt px-4 py-3 text-sm text-rc-muted">
            Trust account reconciliations are now uploaded and signed on the{" "}
            <Link
              href="/dashboard/trust"
              className="font-medium text-rc-green-deep hover:underline"
            >
              Trust account register
            </Link>
            , which tracks which months are outstanding.
          </div>
        )}

        <div className="mt-8 space-y-4">
          <SgReadConfirmationsCard confirmations={readConfirmations} nameOf={nameOf} />
          {/* An agent or assistant sees only the documents they sign (0058),
              so "nothing here yet" would wrongly say the office has none. */}
          {documents.length === 0 && !access.runsOffice && (
            <p className="text-sm text-rc-muted">Nothing waiting on your signature.</p>
          )}
          {documents.length === 0 && access.runsOffice && (
            <p className="text-sm text-rc-muted">
              Nothing here yet. Publishing a new{" "}
              <Link href="/dashboard/sg-manual" className="text-rc-green-deep hover:underline">
                SG Manual version
              </Link>{" "}
              will show up here for sign-off.
            </p>
          )}
          {documents.map((doc, i) =>
            doc.category === "agent_acknowledgement" ? (
              <FiledRecordCard
                key={doc.id}
                document={doc}
                fileUrl={signedUrls[i]?.data?.signedUrl ?? null}
                label="Before you start"
                status="Confirmed"
                details={acknowledgementDetails(acknowledgements.find((a) => a.signoff_document_id === doc.id))}
              />
            ) : doc.category === "sg_annexure_licensee_signed" ? (
              <FiledRecordCard
                key={doc.id}
                document={doc}
                fileUrl={signedUrls[i]?.data?.signedUrl ?? null}
                label="SG annexure"
                status="Uploaded"
                details={[
                  { term: "Uploaded by", value: nameOf(doc.uploaded_by) },
                  { term: "Uploaded", value: when(doc.created_at) },
                ]}
              />
            ) : doc.category === "sg_annexure" ? (
              <AnnexureAdoptionCard
                key={doc.id}
                document={doc}
                adoption={adoptions.find((a) => a.signoff_document_id === doc.id) ?? null}
                fileUrl={signedUrls[i]?.data?.signedUrl ?? null}
              />
            ) : (
            <DocumentSignoffCard
              key={doc.id}
              document={doc}
              signatures={signatures.filter((s) => s.document_id === doc.id)}
              profiles={staff}
              currentProfile={profile}
              ownOnly={!access.runsOffice}
              fileUrl={signedUrls[i]?.data?.signedUrl ?? null}
              notAsked={doc.id === currentSg?.id ? notAskedOnCurrentSg : []}
            />
            ),
          )}
        </div>

        {officeManagers.length > 0 && (
          <section id="office-managers" className="mt-10 scroll-mt-6">
            <h2 className="text-sm font-semibold text-rc-ink">Office manager approvals</h2>
            <p className="mt-1 text-xs text-rc-muted">
              Approved by the licensee in charge, in Team or by email link. Withdrawn approvals stay on the record.
            </p>
            <ul className="mt-3 space-y-3">
              {officeManagers.map((m) => (
                <li key={m.id} className="rounded-card border border-rc-border bg-white p-4 text-sm shadow-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-rc-ink">{m.person_name}</p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        m.withdrawn_at ? "bg-rc-bg-alt text-rc-muted" : "bg-rc-green-soft text-rc-green-deep"
                      }`}
                    >
                      {m.withdrawn_at ? "Withdrawn" : "Office manager"}
                    </span>
                  </div>
                  <p className="mt-2 break-words text-rc-ink">&ldquo;{m.wording}&rdquo;</p>
                  <p className="mt-2 text-xs text-rc-muted">
                    Approved by {m.approved_by_name}, {m.approved_via === "email_link" ? "by email link" : "in Team"},{" "}
                    {formatAuTimestamp(m.approved_at)}.
                    {m.withdrawn_at
                      ? m.withdrawn_via === "left_office"
                        ? ` Ended when they left the office, ${formatAuTimestamp(m.withdrawn_at)}.`
                        : ` Withdrawn by ${m.withdrawn_by_name ?? "the licensee"}, ${
                            m.withdrawn_via === "email_link" ? "by email link" : "in Team"
                          }, ${formatAuTimestamp(m.withdrawn_at)}.`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

/** What the acknowledgement's card shows: who, their number, the licensee, when, which wording. */
function acknowledgementDetails(ack: AgentAcknowledgement | undefined): Array<{ term: string; value: string }> {
  if (!ack) return [];
  return [
    { term: "Agent", value: `${ack.typed_name}, licence or certificate ${ack.agent_licence_number}` },
    { term: "Licensee in charge", value: `${ack.licensee_name}, licence ${ack.licensee_licence_number}` },
    { term: "Confirmed", value: when(ack.confirmed_at) },
    { term: "Wording version", value: ack.wording_version },
  ];
}
