import type { SupabaseClient } from "@supabase/supabase-js";
import { sgChecksOf, type SgChecks } from "@/lib/sg-document/checks";
import { isSgDocType, type SgDocType } from "@/lib/sg-document/fair-trading";

// The office's supervision guidelines as a live document (0122), as the SG
// page and Home read them. Each person sees what the database lets them: the
// live document for everyone in the office, drafts only for whoever runs it.
// Before 0122 has run there's no table: nothing, and the page is as it was.

export type SgDocumentView = {
  id: string;
  status: "reading" | "draft" | "read_failed" | "live";
  fileName: string;
  docType: SgDocType | null;
  versionLabel: string | null;
  versionRead: string | null;
  readError: string | null;
  checks: SgChecks | null;
  fromFileOnRecord: boolean;
  savedAt: string | null;
  savedByName: string | null;
  done: number;
  total: number | null;
};

export type SgSectionView = { position: number; number: string | null; title: string; paragraphs: string[] };

type Row = {
  id: string;
  status: string;
  file_name: string;
  doc_type: string | null;
  version_label: string | null;
  version_read: string | null;
  read_error: string | null;
  checks: unknown;
  from_file_on_record: boolean;
  saved_at: string | null;
  saved_by_name: string | null;
  read_parts: unknown;
  read_total_parts: number | null;
};

function view(r: Row): SgDocumentView {
  return {
    id: r.id,
    status: r.status as SgDocumentView["status"],
    fileName: r.file_name,
    docType: isSgDocType(r.doc_type) ? r.doc_type : null,
    versionLabel: r.version_label,
    versionRead: r.version_read,
    readError: r.read_error,
    checks: sgChecksOf(r.checks),
    fromFileOnRecord: r.from_file_on_record,
    savedAt: r.saved_at,
    savedByName: r.saved_by_name,
    done: Array.isArray(r.read_parts) ? r.read_parts.filter(Boolean).length : 0,
    total: r.read_total_parts,
  };
}

/** The live document and any draft open, each with its sections (a draft only once it's read). */
export async function sgDocumentsFor(supabase: SupabaseClient): Promise<{
  live: { doc: SgDocumentView; sections: SgSectionView[] } | null;
  open: { doc: SgDocumentView; sections: SgSectionView[] } | null;
}> {
  const { data, error } = await supabase
    .from("sg_documents")
    .select(
      "id, status, file_name, doc_type, version_label, version_read, read_error, checks, from_file_on_record, saved_at, saved_by_name, read_parts, read_total_parts",
    )
    .in("status", ["live", "reading", "draft", "read_failed"])
    .order("created_at", { ascending: false });
  if (error || !data) return { live: null, open: null };
  const rows = (data as Row[]).map(view);
  const live = rows.find((r) => r.status === "live") ?? null;
  const open = rows.find((r) => r.status !== "live") ?? null;
  const withSections = [live, open?.status === "draft" ? open : null].filter((d): d is SgDocumentView => d !== null);
  const sectionsOf: Record<string, SgSectionView[]> = {};
  if (withSections.length > 0) {
    const { data: sectionRows } = await supabase
      .from("sg_document_sections")
      .select("document_id, position, number, title, paragraphs")
      .in(
        "document_id",
        withSections.map((d) => d.id),
      )
      .order("position", { ascending: true });
    for (const s of (sectionRows ?? []) as Array<SgSectionView & { document_id: string }>) {
      (sectionsOf[s.document_id] ??= []).push({ position: s.position, number: s.number, title: s.title, paragraphs: s.paragraphs ?? [] });
    }
  }
  return {
    live: live ? { doc: live, sections: sectionsOf[live.id] ?? [] } : null,
    open: open ? { doc: open, sections: sectionsOf[open.id] ?? [] } : null,
  };
}

/** For Home: a draft waiting to be checked, for whoever runs the office (Master, 10 Nov 2026). */
export async function sgDraftWaiting(supabase: SupabaseClient): Promise<{ fileName: string; fromFileOnRecord: boolean } | null> {
  const { data, error } = await supabase
    .from("sg_documents")
    .select("file_name, from_file_on_record")
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { file_name: string; from_file_on_record: boolean };
  return { fileName: r.file_name, fromFileOnRecord: r.from_file_on_record };
}
