import type { SupabaseClient } from "@supabase/supabase-js";

// THE HOLDING AREA FOR A FINISHED AUDIT PACK (Adam, 2 Nov 2026: yes; 0106).
//
// With every document on the listing inside it, a pack can be tens of
// megabytes: more than a Vercel function should send back in one answer. So
// the pack is built on the server as before, saved in the private
// 'audit-packs' bucket, and the browser downloads it straight from Storage
// through a link that lasts a few minutes. Nobody signed in can read or
// write the bucket (no policies on it, 0106): only the server's own key.
// Each copy is deleted the next day (clearOldAuditPacks, run by the daily
// subscription-end job). Same Supabase project, in Sydney; nothing goes
// anywhere new.

export const AUDIT_PACK_BUCKET = "audit-packs";
/** How long the download link lasts. Long enough for a slow connection to start it. */
const LINK_SECONDS = 10 * 60;
/** How long a copy is kept. */
export const KEEP_PACK_MS = 24 * 60 * 60 * 1000;

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
  const path = `${where.agencyId}/${where.propertyId}/${Date.now()}-${crypto.randomUUID()}.pdf`;
  const bucket = service.storage.from(AUDIT_PACK_BUCKET);
  const { error } = await bucket.upload(path, pack.pdf, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error(`audit pack not stored: ${error.message}`);
  const { data, error: linkError } = await bucket.createSignedUrl(path, LINK_SECONDS, inline ? undefined : { download: pack.filename });
  if (linkError || !data?.signedUrl) throw new Error(`audit pack link not made: ${linkError?.message ?? "no link"}`);
  return data.signedUrl;
}

/** Deletes every stored pack older than a day. Returns how many went. Never throws. */
export async function clearOldAuditPacks(service: SupabaseClient, now = Date.now()): Promise<{ removed: number; problem: string | null }> {
  const bucket = service.storage.from(AUDIT_PACK_BUCKET);
  const old: string[] = [];
  try {
    // {agency}/{listing}/{time}-{random}.pdf: the time in the name says how old.
    const walk = async (prefix: string, depth: number): Promise<void> => {
      for (let offset = 0; ; offset += 100) {
        const { data, error } = await bucket.list(prefix, { limit: 100, offset });
        if (error) throw new Error(error.message);
        for (const entry of data ?? []) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (!entry.id) {
            if (depth < 2) await walk(path, depth + 1);
            continue;
          }
          const made = Number(/^(\d{13})-/.exec(entry.name)?.[1] ?? Date.parse(entry.created_at ?? ""));
          if (!Number.isFinite(made) || now - made > KEEP_PACK_MS) old.push(path);
        }
        if (!data || data.length < 100) break;
      }
    };
    await walk("", 0);
    for (let i = 0; i < old.length; i += 100) {
      const { error } = await bucket.remove(old.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }
    return { removed: old.length, problem: null };
  } catch (err) {
    return { removed: 0, problem: err instanceof Error ? err.message : String(err) };
  }
}
