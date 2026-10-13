import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { ADMIN_COPY_ADDRESS, SENDER_NAME } from "@/lib/email/early-access-invite";
import { buildAnnexureSignedEmail } from "@/lib/email/sg-annexure";
import { buildSgAnnexurePdf, sgAnnexureFilename, type SgAnnexurePdfInput } from "@/lib/pdf/sg-annexure";
import { annexureDate } from "@/lib/legal/sg-annexure";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";

// Adopting the SG annexure from a link (brief, 14 Oct 2026; 0067).
//
// The signing page is signed out, like the licensee sign-off page. The token
// in the link is the credential, and everything the page reads or writes goes
// through 0067's functions with the visitor's own (signed-out) access:
// sg_annexure_link_details to show it, adopt_sg_annexure to record it. The
// database decides whether the link still works and records the adoption once.
//
// THE SIGNED COPY uses the server's own key, after the database has accepted
// the adoption, and only for what the visitor cannot do themselves: read the
// office's logo, save the signed PDF in the office's records, file it in
// Document sign-offs and email it. Same arrangement as the sign-off link's
// token (lib/actions/signoff-links.ts). Nobody signed in is acting here, so no
// one's own access is being stepped around.

export type AnnexureLinkState = "open" | "adopted" | "used" | "expired" | "ended";

export type AnnexureLinkDetails = {
  agencyId: string;
  agencyName: string;
  licenceNumber: string | null;
  logoPath: string | null;
  sentTo: string;
  state: AnnexureLinkState;
  adoptedAt: string | null;
};

/** What the page shows for a token, read through 0067's function. Null for a token that never existed. */
export async function linkDetails(
  supabase: Pick<SupabaseClient, "rpc">,
  token: string,
  version: string,
): Promise<AnnexureLinkDetails | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await supabase.rpc("sg_annexure_link_details", { p_token: token, p_version: version });
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        agency_id: string;
        agency_name: string | null;
        licence_number: string | null;
        logo_path: string | null;
        sent_to: string;
        state: AnnexureLinkState;
        adopted_at: string | null;
      }
    | undefined;
  if (error || !row) return null;
  return {
    agencyId: row.agency_id,
    agencyName: row.agency_name?.trim() || "Your agency",
    licenceNumber: row.licence_number?.trim() || null,
    logoPath: row.logo_path,
    sentTo: row.sent_to,
    state: row.state,
    adoptedAt: row.adopted_at,
  };
}

/** The database's sentences that are fit to show the person signing (0067). */
const DATABASE_SENTENCES = new Set([
  "Type your full name.",
  "Type your licence number.",
  "This link is no longer valid.",
  "This annexure has already been adopted.",
]);

export function adoptionRefusal(error: { code?: string; message?: string } | null): string {
  if (error?.code === "23505") return "This annexure has already been adopted.";
  const msg = error?.message?.trim() ?? "";
  if (DATABASE_SENTENCES.has(msg)) return msg;
  if (msg.includes("subscription has ended")) return "This agency's subscription has ended, so the annexure can't be adopted.";
  return "Something went wrong and nothing was signed. Try again in a minute.";
}

/** The office's logo for a PDF, or null. A logo that will not download never costs anyone the document. */
export async function logoFor(
  service: SupabaseClient,
  path: string | null,
): Promise<SgAnnexurePdfInput["logo"]> {
  if (!path) return null;
  try {
    const { data: blob } = await service.storage.from(EVIDENCE_BUCKET).download(path);
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: /\.jpe?g$/i.test(path) ? "jpg" : "png" };
  } catch {
    return null;
  }
}

type AdoptionRow = {
  id: string;
  agency_id: string;
  annexure_version: string;
  signed_name: string;
  licence_number: string;
  sent_to: string;
  signed_at: string;
  signoff_document_id: string | null;
};

/**
 * Makes the signed PDF, files it in Document sign-offs and emails it to the
 * address the link went to, with a copy to admin@. Once: an adoption that
 * already has its copy filed is left alone. Never throws.
 */
export async function saveSignedCopy(
  service: SupabaseClient,
  adoptionId: string,
  deps: { send?: (input: SendEmailInput) => Promise<boolean> } = {},
): Promise<{ filed: boolean; emailed: boolean }> {
  const send = deps.send ?? sendEmail;
  try {
    const { data: row } = await service.from("sg_annexure_adoptions").select("*").eq("id", adoptionId).maybeSingle();
    const adoption = row as AdoptionRow | null;
    if (!adoption) return { filed: false, emailed: false };
    if (adoption.signoff_document_id) return { filed: true, emailed: false };

    const { data: agencyRow } = await service
      .from("agencies")
      .select("name, logo_path")
      .eq("id", adoption.agency_id)
      .maybeSingle();
    const agency = (agencyRow ?? {}) as { name?: string | null; logo_path?: string | null };
    const agencyName = agency.name?.trim() || "Your agency";

    const pdf = await buildSgAnnexurePdf({
      agencyName,
      licenceNumber: adoption.licence_number,
      effectiveDate: annexureDate(adoption.signed_at),
      logo: await logoFor(service, agency.logo_path ?? null),
      adoption: {
        signedName: adoption.signed_name,
        licenceNumber: adoption.licence_number,
        sentTo: adoption.sent_to,
        signedAt: adoption.signed_at,
        version: adoption.annexure_version,
      },
    });

    const fileName = sgAnnexureFilename(agencyName, true);
    const path = `${adoption.agency_id}/_signoffs/sg-annexure-v${adoption.annexure_version}-${adoption.id}.pdf`;
    const { error: uploadError } = await service.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`upload: ${uploadError.message}`);

    // Licensee only, with nobody listed to sign: under the rules already in
    // place (0058's evidence_path_readable and the signoff_documents view
    // policy) only the licensee in charge can see or open it.
    const { data: doc, error: docError } = await service
      .from("signoff_documents")
      .insert({
        agency_id: adoption.agency_id,
        category: "sg_annexure",
        title: `Annexure to the Supervision Guidelines, version ${adoption.annexure_version}`,
        file_path: path,
        file_name: fileName,
        signed_file_path: path,
        signed_file_name: fileName,
        signer_scope: "licensee_only",
        uploaded_by: null,
      })
      .select("id")
      .single();
    if (docError || !doc) throw new Error(`document: ${docError?.message ?? "not saved"}`);

    await service
      .from("sg_annexure_adoptions")
      .update({ signoff_document_id: (doc as { id: string }).id })
      .eq("id", adoption.id);

    const { subject, text, html } = buildAnnexureSignedEmail({ signedName: adoption.signed_name, agencyName });
    const emailed = await send({
      to: adoption.sent_to,
      bcc: ADMIN_COPY_ADDRESS,
      replyTo: ADMIN_COPY_ADDRESS,
      fromName: SENDER_NAME,
      subject,
      text,
      html,
      attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
    });
    if (!emailed) console.error("annexure adoption: signed copy not emailed", adoption.id);
    return { filed: true, emailed };
  } catch (err) {
    console.error("annexure adoption: signed copy failed", adoptionId, err);
    return { filed: false, emailed: false };
  }
}
