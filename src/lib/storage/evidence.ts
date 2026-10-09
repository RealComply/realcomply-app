import type { SupabaseClient } from "@supabase/supabase-js";
import { fileForUpload } from "@/lib/documents/heic-in-the-browser";

// REVERSAL 2 Oct 2026 (Adam): source documents are kept for the life of the subscription. Do NOT purge at settlement. They are deleted with everything else 14 days after the subscription ends.
export const EVIDENCE_BUCKET = "compliance-evidence";
// The cap on anything uploaded as evidence: 150 MB (Adam, 9 Oct 2026).
//
// Off-the-plan contracts with their annexures run well past the old 50 MB.
// The same limit is set on the bucket itself (file_size_limit, 0056), so this
// check is the friendly message and the bucket is the rule. The project-wide
// Storage limit in the Supabase dashboard has to be at least this or the
// bucket setting is capped by it.
//
// Compressing a contract to fit was considered and rejected. It is a legal
// document; altering it to save storage is not a trade this product makes.
export const MAX_EVIDENCE_BYTES = 150 * 1024 * 1024; // 150 MB

// What may be uploaded: PDF, photos, Word, Excel and saved emails (Adam,
// 9 Oct 2026). The same list is set on the bucket (allowed_mime_types, 0056).
//
// By extension as well as by type, because browsers are unreliable about the
// type of a saved email: a .msg often arrives as "" or application/octet-stream,
// and a real email refused for that would be our fault, not the agent's. The
// type sent to Storage is then taken from this table, so the bucket's own
// check sees the right one.
const EVIDENCE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  eml: "message/rfc822",
  msg: "application/vnd.ms-outlook",
};
const ALLOWED_TYPES = new Set(Object.values(EVIDENCE_TYPES));

export const TOO_LARGE_MESSAGE = "This file is over 150 MB. Please upload a smaller copy.";
export const WRONG_TYPE_MESSAGE =
  "This file type isn't accepted. Please upload a PDF, photo, Word, Excel or saved email.";

/** The type to store a file under, or null if it is not one we accept. */
export function evidenceContentType(file: { name: string; type: string }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  return EVIDENCE_TYPES[ext] ?? null;
}

/** The plain message to show if this file cannot be uploaded, else null. */
export function evidenceFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (evidenceContentType(file) === null) return WRONG_TYPE_MESSAGE;
  if (file.size > MAX_EVIDENCE_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

export function sanitizeFileName(name: string): string {
  // Keep it simple and storage-path-safe; the original name is preserved
  // separately in data.evidenceFileName for display.
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

// Canonical evidence path convention that the storage RLS policies in
// supabase/migrations/0002_evidence_storage.sql key off (only the first
// segment, agency_id, is actually checked by RLS — the rest is just a
// readable, collision-free layout).
export function buildEvidencePath(agencyId: string, propertyId: string, itemKey: string, fileName: string): string {
  return `${agencyId}/${propertyId}/${itemKey}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// Same bucket, same RLS (only the agency_id first segment is checked — see
// 0002_evidence_storage.sql), different second segment so these don't
// collide with per-property evidence paths.
export function buildLicenceDocPath(agencyId: string, profileId: string, fileName: string): string {
  return `${agencyId}/_licences/${profileId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The agency's corporation licence (0051). Beside the people's licences, in a
// folder of its own so it can never collide with a profile id.
export function buildCorporationLicenceDocPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_licences/_corporation/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The provider's record of completion for one CPD activity. Kept per person
// rather than per agency folder, because retention is the individual's
// obligation (3 years; 4 for an assistant agent's statement of attainment)
// and it should stay with them if they move.
export function buildCpdDocPath(agencyId: string, profileId: string, fileName: string): string {
  return `${agencyId}/_cpd/${profileId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The agency's own logo, drawn on the finalised compliance record. Same bucket
// and same RLS as everything else here — only the first path segment is
// checked — with its own second segment so it cannot collide with evidence.
export function buildAgencyLogoPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_brand/${Date.now()}-${sanitizeFileName(fileName)}`;
}

export function buildSgManualPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_sg-manual/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// Same bucket, same RLS, its own segment. category keeps sg_manual and
// trust_reconciliation (and whatever's added later) from colliding.
export function buildSignoffDocPath(agencyId: string, category: string, fileName: string): string {
  return `${agencyId}/_signoffs/${category}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// A property doesn't have an id yet while its setup form is being filled
// in, but the browser still needs somewhere RLS-legal to put the file the
// moment it's chosen (see below on why upload happens client-side at all).
// `stagingId` only needs to be unique per in-progress submission — it's
// discarded once the property is created and the object is moved to its
// real, permanent path.
export function buildStagingPath(agencyId: string, stagingId: string, itemKey: string, fileName: string): string {
  return `${agencyId}/_pending/${stagingId}/${itemKey}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// Uploads a file to the private evidence bucket straight from wherever this
// runs. Deliberately used from the BROWSER for real uploads (see
// EvidenceUploader in ItemCard.tsx and the "Add a property" page) rather
// than routed through a Server Action: Vercel Functions hard-cap every
// request body at 4.5MB (non-configurable — this is a platform limit, not
// a Next.js setting), so a Server Action can never reliably carry a real
// multi-MB compliance document. The browser's Supabase client is already
// authenticated with the same session used for signed-URL reads elsewhere
// on this page, so it can write directly to Storage — RLS (agency_id
// prefix match) enforces the same tenant isolation either way. Only the
// resulting path (a short string) then travels through any Server Action.
// HEIC IS CONVERTED HERE, in the one function every upload in the app goes
// through, rather than at the nine call sites that use it (26 Aug 2026).
//
// Nine places is nine chances to forget, and the one that gets forgotten is
// always the one an agent uses at an open home. Doing it here means a new
// upload path added next month inherits the behaviour without anybody
// remembering to ask for it.
//
// Only HEIC is touched. Everything else — every contract, every agency
// agreement — is uploaded byte for byte as the agent chose it. See
// documents/heic-in-the-browser.ts for why this cannot happen on the server.
//
// The returned `file` is what actually went up, so a caller recording a
// display name can use its name rather than the .HEIC the agent picked.
// Callers that ignore it are not broken by it.
export async function uploadEvidenceObject(
  supabase: SupabaseClient,
  params: { path: string; file: File },
): Promise<{ error: string | null; file: File }> {
  const { path } = params;
  // Checked on the file as chosen, before any conversion, so a refused file
  // never costs the agent a HEIC conversion first.
  const problem = evidenceFileProblem(params.file);
  if (problem) return { error: problem, file: params.file };
  const file = await fileForUpload(params.file);

  // And the size again after conversion: what is stored is what counts, and a
  // JPEG off a HEIC is usually the larger of the two.
  if (file.size > MAX_EVIDENCE_BYTES) return { error: TOO_LARGE_MESSAGE, file };

  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: evidenceContentType(file) ?? undefined });

  return { error: error?.message ?? null, file };
}

// Records that a property_items row now points at an already-uploaded
// evidence object — the write half of what attachEvidenceFile used to do
// in one step, split out now that the upload itself happens client-side
// (see uploadEvidenceObject above). Never touches status/note/other data —
// evidence is supporting material, not the record of completion.
export async function finalizeEvidenceRecord(
  supabase: SupabaseClient,
  params: {
    agencyId: string;
    propertyId: string;
    itemKey: string;
    path: string;
    fileName: string;
  },
): Promise<{ error: string | null }> {
  const { agencyId, propertyId, itemKey, path, fileName } = params;

  const { data: existingRow } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey)
    .maybeSingle();

  // Only remove the old file once the new one is confirmed in place, so a
  // problem here never leaves an item with no evidence at all.
  if (existingRow?.evidence_path && existingRow.evidence_path !== path) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existingRow.evidence_path]);
  }

  const { error } = await supabase.from("property_items").upsert(
    {
      agency_id: agencyId,
      property_id: propertyId,
      item_key: itemKey,
      status: existingRow?.status ?? "open",
      data: { ...(existingRow?.data ?? {}), evidenceFileName: fileName },
      event_date: existingRow?.event_date ?? null,
      completed_by: existingRow?.completed_by ?? null,
      evidence_path: path,
    },
    { onConflict: "property_id,item_key" },
  );

  return { error: error?.message ?? null };
}

// Relocates a staged (pre-property-creation) upload to its permanent,
// canonical path once the property row exists — see buildStagingPath.
export async function moveStagedEvidence(
  supabase: SupabaseClient,
  params: { from: string; to: string },
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from(EVIDENCE_BUCKET).move(params.from, params.to);
  return { error: error?.message ?? null };
}
