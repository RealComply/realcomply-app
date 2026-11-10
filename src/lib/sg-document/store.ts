import type { SupabaseClient } from "@supabase/supabase-js";
import { noteRead, staffReadRecord } from "@/lib/documents/read-record";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { sgFileKind } from "@/lib/sg-document/read";
import type { SgReadDoc, SgReadProgress, SgReadStore } from "@/lib/sg-document/advance";

// The reading's database side, with the service key (0122: a signed-in
// person can't write these rows; the four functions there are their only
// way in). Only ever used on the server, after the caller has checked who is
// asking, or by the hourly job.

export function sgReadStore(service: SupabaseClient): SgReadStore {
  const docs = () => service.from("sg_documents");
  return {
    async claim(id, minutes) {
      const now = new Date();
      const { data, error } = await docs()
        .update({ read_claimed_until: new Date(now.getTime() + minutes * 60_000).toISOString() })
        .eq("id", id)
        .eq("status", "reading")
        .or(`read_claimed_until.is.null,read_claimed_until.lt.${now.toISOString()}`)
        .select("id, agency_id, file_path, file_name, read_parts")
        .maybeSingle();
      if (error) {
        console.error("sg document not claimed:", error.message);
        return null;
      }
      return (data as SgReadDoc | null) ?? null;
    },

    async progress(id) {
      const { data } = await docs().select("status, read_parts, read_total_parts").eq("id", id).maybeSingle();
      const row = data as { status: string; read_parts: unknown; read_total_parts: number | null } | null;
      if (!row) return { status: "read_failed", done: 0, total: null };
      const done = Array.isArray(row.read_parts) ? row.read_parts.filter(Boolean).length : 0;
      const status: SgReadProgress["status"] =
        row.status === "reading" ? "elsewhere" : row.status === "read_failed" ? "read_failed" : "draft";
      return { status, done, total: row.read_total_parts };
    },

    async download(path) {
      const { data, error } = await service.storage.from(EVIDENCE_BUCKET).download(path);
      if (error || !data) {
        const message = error?.message ?? "no file";
        return /not.?found|does not exist|no file/i.test(message) ? { missing: true } : { error: message };
      }
      return { bytes: new Uint8Array(await data.arrayBuffer()) };
    },

    async saveParts(id, parts, total) {
      const { error } = await docs().update({ read_parts: parts, read_total_parts: total }).eq("id", id).eq("status", "reading");
      if (error) console.error("sg document parts not kept:", error.message);
    },

    async release(id) {
      await docs().update({ read_claimed_until: null }).eq("id", id);
    },

    async officeNames(agencyId) {
      const [{ data: agency }, { data: licensees }] = await Promise.all([
        service.from("agencies").select("name, licensed_entity_name, licensee_name").eq("id", agencyId).maybeSingle(),
        service.from("profiles").select("full_name").eq("agency_id", agencyId).eq("is_licensee_in_charge", true).is("archived_at", null),
      ]);
      const a = (agency ?? {}) as { name?: string | null; licensed_entity_name?: string | null; licensee_name?: string | null };
      return {
        businessNames: [a.name, a.licensed_entity_name].filter((n): n is string => Boolean(n)),
        licenseeNames: [a.licensee_name, ...((licensees ?? []) as Array<{ full_name: string | null }>).map((p) => p.full_name)].filter(
          (n): n is string => Boolean(n),
        ),
      };
    },

    async finish(id, agencyId, done) {
      // A document read again starts its sections afresh.
      await service.from("sg_document_sections").delete().eq("document_id", id);
      const { error: sectionsError } = await service.from("sg_document_sections").insert(
        done.sections.map((s) => ({
          document_id: id,
          agency_id: agencyId,
          position: s.position,
          number: s.number,
          title: s.title,
          paragraphs: s.paragraphs,
        })),
      );
      if (sectionsError) throw new Error(`sections not kept: ${sectionsError.message}`);
      const { error } = await docs()
        .update({
          status: "draft",
          version_read: done.version,
          checks: done.checks,
          read_at: new Date().toISOString(),
          read_claimed_until: null,
          read_error: null,
        })
        .eq("id", id)
        .eq("status", "reading");
      if (error) throw new Error(`draft not kept: ${error.message}`);
    },

    async fail(id, plain) {
      await docs()
        .update({ status: "read_failed", read_error: plain.slice(0, 500), read_claimed_until: null })
        .eq("id", id)
        .eq("status", "reading");
    },

    async note(agencyId, fileName, outcome, error) {
      await noteRead(staffReadRecord(service, agencyId), {
        reader: "sg_manual",
        card: "Supervision guidelines",
        fileName,
        outcome,
        error,
      });
    },
  };
}

/**
 * The manuals already on file (Master, 10 Nov 2026: "A"): each office whose
 * subscription hasn't ended, with a Word or PDF manual on file and nothing
 * read yet, gets its newest manual read into a draft. Runs from the hourly
 * job; an office it has done once (whatever happened after) is never done
 * again. Returns how many were started.
 */
export async function startDraftsFromFilesOnRecord(service: SupabaseClient): Promise<number> {
  const [{ data: versions }, { data: started }, { data: ended }] = await Promise.all([
    service.from("sg_manual_versions").select("id, agency_id, file_path, file_name, created_at").order("created_at", { ascending: false }),
    service.from("sg_documents").select("agency_id"),
    service.from("agencies").select("id").not("ended_at", "is", null),
  ]);
  const done = new Set(((started ?? []) as Array<{ agency_id: string }>).map((r) => r.agency_id));
  const over = new Set(((ended ?? []) as Array<{ id: string }>).map((r) => r.id));
  const newest = new Map<string, { id: string; agency_id: string; file_path: string; file_name: string }>();
  for (const v of (versions ?? []) as Array<{ id: string; agency_id: string; file_path: string; file_name: string }>) {
    if (!newest.has(v.agency_id)) newest.set(v.agency_id, v);
  }
  let count = 0;
  for (const v of newest.values()) {
    if (done.has(v.agency_id) || over.has(v.agency_id) || !sgFileKind(v.file_name)) continue;
    const { error } = await service.from("sg_documents").insert({
      agency_id: v.agency_id,
      manual_version_id: v.id,
      file_path: v.file_path,
      file_name: v.file_name.slice(0, 300),
      status: "reading",
      from_file_on_record: true,
    });
    if (error) console.error("sg draft from file on record not started:", error.message);
    else count++;
  }
  return count;
}

/** The documents waiting to be read, oldest first, for the hourly job. */
export async function documentsBeingRead(service: SupabaseClient, limit = 10): Promise<string[]> {
  const { data } = await service
    .from("sg_documents")
    .select("id")
    .eq("status", "reading")
    .or(`read_claimed_until.is.null,read_claimed_until.lt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}
