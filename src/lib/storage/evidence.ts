import type { SupabaseClient } from "@supabase/supabase-js";

export const EVIDENCE_BUCKET = "compliance-evidence";
const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024; // 20MB

export function sanitizeFileName(name: string): string {
  // Keep it simple and storage-path-safe; the original name is preserved
  // separately in data.evidenceFileName for display.
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

// Uploads a file to the private evidence bucket and attaches it to a
// property_items row, without touching that row's status, note, or any
// other data — evidence is supporting material, not the record of
// completion. Shared by the per-item "attach evidence" action
// (src/lib/actions/compliance.ts) and the property-setup upload fields
// (agency agreement / contract for sale / comparable-sales report), so both
// paths use the exact same path convention
// (`agency_id/property_id/item_key/timestamp-filename`) that the storage
// RLS policies in supabase/migrations/0002_evidence_storage.sql key off.
export async function attachEvidenceFile(
  supabase: SupabaseClient,
  params: {
    agencyId: string;
    propertyId: string;
    itemKey: string;
    file: File;
  },
): Promise<{ error: string | null }> {
  const { agencyId, propertyId, itemKey, file } = params;

  if (file.size > MAX_EVIDENCE_BYTES) {
    return { error: `${file.name} is too large — 20MB max.` };
  }

  const { data: existingRow } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey)
    .maybeSingle();

  const path = `${agencyId}/${propertyId}/${itemKey}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });

  if (uploadError) {
    return { error: uploadError.message };
  }

  // Only remove the old file once the new one is safely uploaded, so a
  // failed upload never leaves an item with no evidence at all.
  if (existingRow?.evidence_path) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existingRow.evidence_path]);
  }

  const { error } = await supabase.from("property_items").upsert(
    {
      agency_id: agencyId,
      property_id: propertyId,
      item_key: itemKey,
      status: existingRow?.status ?? "open",
      data: { ...(existingRow?.data ?? {}), evidenceFileName: file.name },
      event_date: existingRow?.event_date ?? null,
      completed_by: existingRow?.completed_by ?? null,
      evidence_path: path,
    },
    { onConflict: "property_id,item_key" },
  );

  return { error: error?.message ?? null };
}
