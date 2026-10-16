import type { SupabaseClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { logoFor } from "@/lib/sg-annexure/adopt";
import { ACK_DOCUMENT_TITLE } from "@/lib/agent-acknowledgement";
import { agentAcknowledgementFilename, buildAgentAcknowledgementPdf } from "@/lib/pdf/agent-acknowledgement";

// Files an agent acknowledgement's PDF in Registers, Document sign-offs (job 7
// brief, Part 2), with the service key, once: an acknowledgement that already
// has its PDF filed is left alone. Never throws; nobody is emailed.

export type AcknowledgementRow = {
  id: string;
  agency_id: string;
  profile_id: string | null;
  agent_licence_number: string;
  agency_name: string;
  licensee_name: string;
  licensee_licence_number: string;
  wording_version: string;
  wording: unknown;
  typed_name: string;
  confirmed_at: string;
  signoff_document_id: string | null;
};

export async function fileAcknowledgementPdf(
  service: SupabaseClient,
  acknowledgementId: string,
  deps: { build?: typeof buildAgentAcknowledgementPdf } = {},
): Promise<{ filed: boolean }> {
  const build = deps.build ?? buildAgentAcknowledgementPdf;
  try {
    const { data: row } = await service
      .from("agent_acknowledgements")
      .select("*")
      .eq("id", acknowledgementId)
      .maybeSingle();
    const ack = row as AcknowledgementRow | null;
    if (!ack) return { filed: false };
    if (ack.signoff_document_id) return { filed: true };

    const { data: agencyRow } = await service.from("agencies").select("logo_path").eq("id", ack.agency_id).maybeSingle();
    const logoPath = (agencyRow as { logo_path?: string | null } | null)?.logo_path ?? null;

    const statements = Array.isArray(ack.wording) ? ack.wording.map((s) => String(s)) : [];
    const pdf = await build({
      agentName: ack.typed_name,
      agentLicenceNumber: ack.agent_licence_number,
      agencyName: ack.agency_name,
      licenseeName: ack.licensee_name,
      licenseeLicenceNumber: ack.licensee_licence_number,
      version: ack.wording_version,
      statements,
      confirmedAt: ack.confirmed_at,
      logo: await logoFor(service, logoPath),
    });

    const fileName = agentAcknowledgementFilename(ack.typed_name);
    const path = `${ack.agency_id}/_signoffs/agent-acknowledgement-v${ack.wording_version}-${ack.id}.pdf`;
    const { error: uploadError } = await service.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`upload: ${uploadError.message}`);

    // Filed as the agent's own, so they see it under the existing rules
    // (0058: the uploader, or whoever acts as the licensee, which on their own
    // plan is them too). Nobody is asked to sign it.
    const { data: doc, error: docError } = await service
      .from("signoff_documents")
      .insert({
        agency_id: ack.agency_id,
        category: "agent_acknowledgement",
        title: ACK_DOCUMENT_TITLE,
        file_path: path,
        file_name: fileName,
        signed_file_path: path,
        signed_file_name: fileName,
        signer_scope: "licensee_only",
        uploaded_by: ack.profile_id,
      })
      .select("id")
      .single();
    if (docError || !doc) throw new Error(`document: ${docError?.message ?? "not saved"}`);

    await service
      .from("agent_acknowledgements")
      .update({ signoff_document_id: (doc as { id: string }).id })
      .eq("id", ack.id);
    return { filed: true };
  } catch (err) {
    console.error("agent acknowledgement: PDF not filed", acknowledgementId, err);
    return { filed: false };
  }
}
