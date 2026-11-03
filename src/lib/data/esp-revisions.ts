import type { SupabaseClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET, isInFolder } from "@/lib/storage/evidence";
import {
  espVersions,
  pendingFrom,
  revisionFrom,
  revisionsOrCard,
  type EspRevision,
} from "@/lib/esp-history";
import type { PropertyItem } from "@/lib/types";

// The listing's ESP revisions (esp_revisions, 0110), oldest first, read with
// the caller's own access. Before 0110 runs this reads nothing, and the card
// shows what it holds as Revision 1 (revisionsOrCard).

export async function espRevisionsFor(supabase: SupabaseClient, agencyId: string, propertyId: string): Promise<EspRevision[]> {
  const { data, error } = await supabase
    .from("esp_revisions")
    .select("revision_no, esp_low, esp_high, notice_given_on, notice_path, notice_file_name, entered_manually, recorded_by_name, recorded_at")
    .eq("agency_id", agencyId)
    .eq("property_id", propertyId)
    .order("revision_no", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map(revisionFrom).filter((r): r is EspRevision => r !== null);
}

const fileNameOf = (data: unknown, path: string) => {
  const name = (data as { evidenceFileName?: unknown } | null)?.evidenceFileName;
  return typeof name === "string" && name.trim() ? name.trim() : (path.split("/").pop() ?? "document").replace(/^\d{13}-/, "");
};

/**
 * What the ESP revision card shows (Adam, 3 Nov 2026; the approved mockup):
 * every version newest first, the original ESP from the agency agreement at
 * the bottom, and a link (an hour) to each notice, the agency agreement and
 * the draft's notice. Only files in the listing's own folder.
 */
export async function espHistoryFor(
  supabase: SupabaseClient,
  agencyId: string,
  propertyId: string,
  allItems: Record<string, PropertyItem | undefined>,
) {
  const revisions = revisionsOrCard(await espRevisionsFor(supabase, agencyId, propertyId), allItems["d3"]);
  const a4 = (allItems["a4"]?.data ?? {}) as { espLow?: unknown; espHigh?: unknown };
  const a3 = allItems["a3"];
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const agreementFile = a3?.evidence_path ? { path: a3.evidence_path, name: fileNameOf(a3.data, a3.evidence_path) } : null;
  const versions = espVersions(
    { low: num(a4.espLow), high: num(a4.espHigh), agreementDate: a3?.event_date ?? null, file: agreementFile },
    revisions,
  );
  const folder = `${agencyId}/${propertyId}`;
  const pending = pendingFrom(allItems["d3"]?.data);
  const paths = [
    ...revisions.map((r) => r.noticePath),
    ...(agreementFile ? [agreementFile.path] : []),
    ...(pending ? [pending.path] : []),
  ].filter((p) => isInFolder(p, folder));
  const fileUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls([...new Set(paths)], 3600);
    for (const f of data ?? []) if (f.path && f.signedUrl) fileUrls[f.path] = f.signedUrl;
  }
  return { versions, fileUrls, latestNo: revisions.length > 0 ? revisions[revisions.length - 1].no : null };
}
