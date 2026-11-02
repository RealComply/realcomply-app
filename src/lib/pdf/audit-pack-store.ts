import type { SupabaseClient } from "@supabase/supabase-js";

// THE HOLDING AREA FOR A FINISHED AUDIT PACK (Adam, 2 Nov 2026: yes; 0106).
//
// With every document on the listing inside it, a pack can be tens of
// megabytes: more than a Vercel function should send back in one answer. So
// the pack is built on the server as before, saved in the private
// 'audit-packs' bucket, and the browser downloads it straight from Storage
// through a link that lasts a few minutes. Nobody signed in can read or
// write the bucket (no policies on it, 0106): only the server's own key.
// Same Supabase project, in Sydney; nothing goes anywhere new.
//
// CHANGE (Adam, 2 Nov 2026, before merge).
// WAS: each copy was kept a day and cleared by the daily subscription-end
//   job, so it lasted 24 to 48 hours. The day-14 deletion and deleting a
//   listing didn't touch it.
// NOW: a copy lasts only as long as its download link (10 minutes, plus 5 for
//   a download already under way). It is cleared by the hourly clean-up
//   (/api/cron/audit-packs) and whenever a new pack is made for the same
//   listing, so it is gone within about 75 minutes. The day-14 deletion
//   removes the office's packs before its documents
//   (lib/subscription-end/deletion.ts), and deleting a listing removes its
//   packs with its files (lib/actions/properties.ts). Packs are never in the
//   hourly backup: it copies the documents bucket only.
// WHY: a pack is a full copy of the listing's documents, so it must never
//   outlive the originals.

export const AUDIT_PACK_BUCKET = "audit-packs";
/**
 * The biggest pack the holding area takes: the bucket's own limit (0106). The
 * project-wide upload limit (Supabase: Storage, Settings, Global file size
 * limit) must be at least this, or it caps the bucket. Uploads of evidence
 * keep their own 150 MB limit on their bucket (0056).
 */
export const AUDIT_PACK_MAX_BYTES = 500 * 1024 * 1024;
/**
 * The most document bytes one pack takes (lib/pdf/compliance-record.ts). Below
 * AUDIT_PACK_MAX_BYTES to leave room for the record, the contents and the
 * separator pages, and for a PDF growing a little as its pages are copied in.
 * Building a pack this size takes about 1 GB of the server's memory (measured
 * 2 Nov 2026: about 2.2 times the pack's size).
 */
export const PACK_DOCUMENTS_MAX_BYTES = 450 * 1024 * 1024;
/** How long the download link lasts. Long enough for a slow connection to start it. */
export const LINK_SECONDS = 10 * 60;
/** How long a copy is kept: its link, and 5 minutes for a download already under way. */
export const KEEP_PACK_MS = (LINK_SECONDS + 5 * 60) * 1000;

/**
 * Saves the finished pack and returns a short-lived link to it. `inline` opens
 * it in the browser's PDF viewer (the licensee's sign-off page) instead of
 * saving it. `service` must be the server's own client: the bucket has no
 * policies for anyone else.
 */
export async function storeAuditPack(
  service: SupabaseClient,
  pack: { pdf: Uint8Array; filename: string },
  where: { agencyId: string; propertyId: string },
  { inline = false }: { inline?: boolean } = {},
): Promise<string> {
  if (pack.pdf.length > AUDIT_PACK_MAX_BYTES) {
    throw new Error(`audit pack not stored: ${Math.round(pack.pdf.length / 1048576)} MB is over the holding area's limit`);
  }
  const path = `${where.agencyId}/${where.propertyId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
  const bucket = service.storage.from(AUDIT_PACK_BUCKET);
  const { error } = await bucket.upload(path, pack.pdf, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`audit pack not stored: ${error.message}`);
  const { data, error: linkError } = await bucket.createSignedUrl(path, LINK_SECONDS, inline ? undefined : { download: pack.filename });
  if (linkError || !data?.signedUrl) throw new Error(`audit pack link not made: ${linkError?.message ?? "no link"}`);
  // This listing's earlier packs whose links have run out go now, not at the next hourly clean-up.
  const cleared = await clearOldAuditPacks(service, Date.now(), `${where.agencyId}/${where.propertyId}`);
  if (cleared.problem) console.error("audit packs not cleared:", cleared.problem);
  return data.signedUrl;
}

type Bucket = ReturnType<SupabaseClient["storage"]["from"]>;

/**
 * Every stored pack under `prefix` ("" for all; "{agency}" for an office;
 * "{agency}/{listing}" for a listing), with when it was made. Throws on a
 * listing error.
 */
async function packsUnder(bucket: Bucket, prefix: string): Promise<Array<{ path: string; made: number }>> {
  const out: Array<{ path: string; made: number }> = [];
  // {agency}/{listing}/{time}-{random}.pdf: the time in the name says when it was made.
  const walk = async (folder: string, depth: number): Promise<void> => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(folder, { limit: 100, offset });
      if (error) throw new Error(error.message);
      for (const entry of data ?? []) {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        if (!entry.id) {
          if (depth < 3) await walk(path, depth + 1);
          continue;
        }
        out.push({ path, made: Number(/^(\d{13})-/.exec(entry.name)?.[1] ?? Date.parse(entry.created_at ?? "")) });
      }
      if (!data || data.length < 100) break;
    }
  };
  await walk(prefix, 0);
  return out;
}

async function removePaths(bucket: Bucket, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await bucket.remove(paths.slice(i, i + 100));
    if (error) throw new Error(error.message);
  }
}

/**
 * Deletes every stored pack whose link has run out (older than KEEP_PACK_MS),
 * under `prefix` (all of them by default). Returns how many went. Never throws.
 */
export async function clearOldAuditPacks(
  service: SupabaseClient,
  now = Date.now(),
  prefix = "",
): Promise<{ removed: number; problem: string | null }> {
  try {
    const bucket = service.storage.from(AUDIT_PACK_BUCKET);
    const old = (await packsUnder(bucket, prefix))
      .filter((p) => !Number.isFinite(p.made) || now - p.made > KEEP_PACK_MS)
      .map((p) => p.path);
    await removePaths(bucket, old);
    return { removed: old.length, problem: null };
  } catch (err) {
    return { removed: 0, problem: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deletes every stored pack under `prefix`, whatever its age: an office's
 * ("{agency}") at the day-14 deletion, or a listing's ("{agency}/{listing}")
 * when the listing is deleted. Then looks again: `left` is how many are still
 * there (0 when it worked). Never throws.
 */
export async function removeAuditPacks(
  service: SupabaseClient,
  prefix: string,
): Promise<{ removed: number; left: number; problem: string | null }> {
  if (!prefix) return { removed: 0, left: 0, problem: "no folder given" };
  try {
    const bucket = service.storage.from(AUDIT_PACK_BUCKET);
    const paths = (await packsUnder(bucket, prefix)).map((p) => p.path);
    await removePaths(bucket, paths);
    const left = (await packsUnder(bucket, prefix)).length;
    return { removed: paths.length, left, problem: left > 0 ? `${left} packs still there` : null };
  } catch (err) {
    return { removed: 0, left: -1, problem: err instanceof Error ? err.message : String(err) };
  }
}
