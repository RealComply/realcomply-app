import type { SupabaseClient } from "@supabase/supabase-js";

export const EVIDENCE_BUCKET = "compliance-evidence";
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024; // 20MB

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

export function buildSgManualPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_sg-manual/${Date.now()}-${sanitizeFileName(fileName)}`;
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
export async function uploadEvidenceObject(
  supabase: SupabaseClient,
  params: { path: string; file: File },
): Promise<{ error: string | null }> {
  const { path, file } = params;

  if (file.size > MAX_EVIDENCE_BYTES) {
    return { error: `${file.name} is too large — 20MB max.` };
  }

  const { error } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });

  return { error: error?.message ?? null };
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
