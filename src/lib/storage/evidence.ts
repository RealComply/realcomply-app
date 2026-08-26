import type { SupabaseClient } from "@supabase/supabase-js";
import { fileForUpload } from "@/lib/documents/heic-in-the-browser";

export const EVIDENCE_BUCKET = "compliance-evidence";
// The cap on anything uploaded as evidence.
//
// Raised from 20MB to 50MB on 25 Aug 2026. Adam: "there is a size limit of
// 20MB which will stop many contract for sale being uploaded" — and he is
// right. A NSW contract for sale with the prescribed documents attached is
// routinely 10-20MB and not rarely more; the contracts in his own Dropbox run
// to 36MB.
//
// 20MB was ours, not a platform limit. The bucket sets no file_size_limit
// (0002_evidence_storage.sql), so it inherits the project-level global limit,
// which Supabase defaults to 50MB — hence 50MB here rather than something
// larger. Going beyond that needs the project setting raised first, and above
// roughly 6MB Supabase's own guidance is to use resumable uploads, which this
// does not yet do: a 45MB file over a phone connection at an open home is the
// case that will fail. See RealComply-launch-readiness.md.
//
// Compressing a contract to fit was considered and rejected. It is a legal
// document; altering it to save storage is not a trade this product makes.
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024; // 50MB

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
  const file = await fileForUpload(params.file);

  // Checked after conversion, not before: what matters is the size of the
  // thing being stored. A JPEG off a HEIC is usually the larger of the two.
  if (file.size > MAX_EVIDENCE_BYTES) {
    // The message used to say 20 MB, which stopped being true on 25 Aug when
    // the cap went to 50 — a stale number in an error is worse than no number,
    // because someone will act on it and compress a legal document to fit.
    const mb = Math.round(MAX_EVIDENCE_BYTES / (1024 * 1024));
    return { error: `${file.name} is larger than the ${mb} MB limit.`, file };
  }

  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });

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
