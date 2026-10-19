import type { SupabaseClient } from "@supabase/supabase-js";
import { fileForUpload } from "@/lib/documents/heic-in-the-browser";
import { EMPTY_FILE_MESSAGE, fileReadsEmpty } from "@/lib/storage/empty-file";

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

// Empty files are refused everywhere (Adam, 19 Oct 2026); why and where is in
// lib/storage/empty-file.ts.
export { EMPTY_FILE_MESSAGE, fileReadsEmpty };

/** The type to store a file under, or null if it is not one we accept. */
export function evidenceContentType(file: { name: string; type: string }): string | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ALLOWED_TYPES.has(file.type)) return file.type;
  return EVIDENCE_TYPES[ext] ?? null;
}

/** The plain message to show if this file cannot be uploaded, else null. */
export function evidenceFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (evidenceContentType(file) === null) return WRONG_TYPE_MESSAGE;
  if (file.size === 0) return EMPTY_FILE_MESSAGE;
  if (file.size > MAX_EVIDENCE_BYTES) return TOO_LARGE_MESSAGE;
  return null;
}

/**
 * The size of a stored file in bytes, as Storage holds it, or null when it
 * cannot be told. Asked with the caller's own client, so it reads only what
 * they may read.
 */
export async function storedFileSize(supabase: SupabaseClient, path: string): Promise<number | null> {
  const bucket = supabase.storage.from(EVIDENCE_BUCKET);
  try {
    const { data, error } = await bucket.info(path);
    const size = data?.size ?? (data?.metadata as { size?: unknown } | undefined)?.size;
    if (!error && typeof size === "number") return size;
  } catch {
    // Fall through to the folder listing.
  }
  // The listing carries the size too, for a Storage that does not answer info.
  const slash = path.lastIndexOf("/");
  const folder = slash >= 0 ? path.slice(0, slash) : "";
  const name = path.slice(slash + 1);
  try {
    const { data, error } = await bucket.list(folder, { search: name, limit: 100 });
    if (error) return null;
    const size = (data ?? []).find((entry) => entry.name === name)?.metadata?.size;
    return typeof size === "number" ? size : null;
  } catch {
    return null;
  }
}

/**
 * The server's own check before a record names an uploaded file: refused when
 * Storage holds it as empty. Anything that cannot be told is let through, so a
 * slow answer from Storage never stops a real upload; the browser has already
 * refused an empty file before sending it.
 */
export async function storedFileProblem(supabase: SupabaseClient, path: string): Promise<string | null> {
  return (await storedFileSize(supabase, path)) === 0 ? EMPTY_FILE_MESSAGE : null;
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
/**
 * Whether a stored path is inside the folder its record says it belongs to.
 * A record's path is written by whoever may change the record, but the files
 * it names are removed with the licensee's access (deleting a listing or a
 * CPD record, removing or replacing a card's file). So a path anywhere else
 * is left alone rather than trusted (review of the 10 Oct 2026 fixes; the
 * database refuses such paths from 0060 too).
 */
export function isInFolder(path: string, folder: string): boolean {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return (
    new TextEncoder().encode(path).length <= 1024 &&
    path.startsWith(prefix) &&
    !path.slice(prefix.length).split("/").includes("..")
  );
}

/**
 * Whether the licensee replacing or removing a card's file may delete the
 * old one: only when it is in that card's own folder and no other card in
 * the agency still names it. A card's path is written by whoever may change
 * the card, so an agent could point one card at another card's filed
 * document on the same listing (review of the 10 Oct 2026 fixes). Anything
 * else is just taken off the card; it stays in the listing's folder, which
 * deleting the listing sweeps.
 */
export async function cardFileRemovable(
  supabase: SupabaseClient,
  card: { agencyId: string; propertyId: string; itemKey: string; path: string },
): Promise<boolean> {
  if (!isInFolder(card.path, `${listingFolder(card.agencyId, card.propertyId)}${card.itemKey}/`)) return false;
  const { data, error } = await supabase
    .from("property_items")
    .select("property_id, item_key")
    .eq("agency_id", card.agencyId)
    .eq("evidence_path", card.path);
  if (error) return false;
  return !(data ?? []).some(
    (row: { property_id: string; item_key: string }) =>
      row.property_id !== card.propertyId || row.item_key !== card.itemKey,
  );
}

export function listingFolder(agencyId: string, propertyId: string): string {
  return `${agencyId}/${propertyId}/`;
}

export function cpdFolder(agencyId: string, profileId: string): string {
  return `${agencyId}/_cpd/${profileId}/`;
}

export function buildLicenceDocPath(agencyId: string, profileId: string, fileName: string): string {
  return `${agencyId}/_licences/${profileId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The agency's corporation licence (0051). Beside the people's licences, in a
// folder of its own so it can never collide with a profile id.
export function buildCorporationLicenceDocPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_licences/_corporation/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// An Insurance register policy's certificate of currency or schedule (0076),
// one folder per policy. The database refuses a policy pointing anywhere
// else. Earlier certificates stay here after a renewal; insurance_history
// says which was which.
export function insuranceFolder(agencyId: string, policy: "pi" | "cyber" | "icare"): string {
  return `${agencyId}/_insurance/${policy}/`;
}

export function buildInsuranceDocPath(agencyId: string, policy: "pi" | "cyber" | "icare", fileName: string): string {
  return `${insuranceFolder(agencyId, policy)}${Date.now()}-${sanitizeFileName(fileName)}`;
}

// Other insurance an office adds (0078): one folder per added policy, by its
// id. The database refuses a certificate anywhere else.
export function otherInsuranceFolder(agencyId: string, policyId: string): string {
  return `${agencyId}/_insurance/other/${policyId}/`;
}

export function buildOtherInsuranceDocPath(agencyId: string, policyId: string, fileName: string): string {
  return `${otherInsuranceFolder(agencyId, policyId)}${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The provider's record of completion for one CPD activity. Kept per person
// rather than per agency folder, because retention is the individual's
// obligation (3 years; 4 for an assistant agent's statement of attainment)
// and it should stay with them if they move.
export function buildCpdDocPath(agencyId: string, profileId: string, fileName: string): string {
  return `${agencyId}/_cpd/${profileId}/${Date.now()}-${sanitizeFileName(fileName)}`;
}

// A document for training plan item that has no CPD record: office training
// that doesn't count for CPD (15 Oct 2026). In the person's own folder, in a
// folder of its own, so it can't be mistaken for a CPD certificate (those
// live on the CPD record only) or removed as an unsaved one (0075 looks only
// at files directly in the person's folder).
export function planItemFolder(agencyId: string, profileId: string): string {
  return `${agencyId}/_cpd/${profileId}/training-plan/`;
}

export function buildPlanItemDocPath(agencyId: string, profileId: string, fileName: string): string {
  return `${planItemFolder(agencyId, profileId)}${Date.now()}-${sanitizeFileName(fileName)}`;
}

// The agency's own logo, drawn on the finalised compliance record. Same bucket
// and same RLS as everything else here — only the first path segment is
// checked — with its own second segment so it cannot collide with evidence.
export function buildAgencyLogoPath(agencyId: string, fileName: string): string {
  return `${agencyId}/_brand/${Date.now()}-${sanitizeFileName(fileName)}`;
}

/**
 * A link the browser can load the agency's logo from, or null when there is
 * none or it can't be signed. Signed with the viewer's own client: every
 * member of the agency may read its _brand folder (0058,
 * evidence_path_readable). A day, not an hour: the sidebar keeps its first
 * render while someone moves from page to page, and an expired link would
 * leave a broken image in it.
 */
export async function agencyLogoUrl(
  supabase: SupabaseClient,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  try {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60 * 60 * 24);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
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
  if (await fileReadsEmpty(params.file)) return { error: EMPTY_FILE_MESSAGE, file: params.file };
  const file = await fileForUpload(params.file);

  // And the size again after conversion: what is stored is what counts, and a
  // JPEG off a HEIC is usually the larger of the two.
  if (file.size === 0) return { error: EMPTY_FILE_MESSAGE, file };
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

  // Never an empty file on a card (19 Oct 2026). The card is left exactly as
  // it was: open stays open, and a file already on it stays on it.
  const empty = await storedFileProblem(supabase, path);
  if (empty) return { error: empty };

  const { data: existingRow, error: readError } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey)
    .maybeSingle();
  // A read that fails is not an empty card. Taken as one, the save below
  // would write the card back as "open" with nothing on it, losing what the
  // agent had done on it (code review fixes, part E, 12 Oct 2026).
  if (readError) return { error: "Couldn't attach the file just now, and nothing was changed. Try again." };

  // THE NEW FILE IS ON THE CARD BEFORE THE OLD ONE GOES (code review fixes,
  // part E, 12 Oct 2026). The new file is already in Storage under its own
  // name (uploadEvidenceObject never overwrites), so the card is pointed at
  // it first. Only once the database confirms the card now names the new
  // file is the old one removed. If the save fails, or is quietly refused,
  // the card still names the old file and the old file is still there. It
  // used to be the other way round: the old file was removed first, and a
  // save that then failed left the card pointing at nothing.
  const { data: saved, error } = await supabase
    .from("property_items")
    .upsert(
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
    )
    .select("evidence_path");
  if (error) return { error: error.message };
  const onCard = ((saved ?? []) as Array<{ evidence_path: string | null }>).some((r) => r.evidence_path === path);
  if (!onCard) return { error: "Couldn't attach the file just now, and nothing was changed. Try again." };

  // Since 0058 only the licensee deletes files, so for anyone else the
  // database quietly refuses this and the old file stays in the listing's
  // folder with nothing pointing at it. Deleting the listing sweeps the whole
  // folder (listPropertyEvidencePaths), which is where it goes (10 Oct 2026).
  if (
    existingRow?.evidence_path &&
    existingRow.evidence_path !== path &&
    (await cardFileRemovable(supabase, { agencyId, propertyId, itemKey, path: existingRow.evidence_path }))
  ) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existingRow.evidence_path]);
  }

  return { error: null };
}

// Every object in one listing's folder, {agency}/{property}/{item}/{file}.
//
// For deleting a listing (10 Oct 2026). The evidence_path column does not
// name every file a listing has: f3's reports are in its entries, and a file
// an agent replaced is still there, because only the licensee can delete
// one. Reading the folder finds them all.
//
// list() returns one level at a time, and a folder comes back with no id, so
// this walks down. Throws if a level cannot be read, rather than calling an
// unreadable folder empty.
export async function listPropertyEvidencePaths(
  supabase: SupabaseClient,
  agencyId: string,
  propertyId: string,
): Promise<string[]> {
  const PAGE = 100;
  const walk = async (prefix: string, depth: number): Promise<string[]> => {
    if (depth > 4) return [];
    const out: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase.storage.from(EVIDENCE_BUCKET).list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(`could not list ${prefix}: ${error.message}`);
      for (const entry of data ?? []) {
        const path = `${prefix}/${entry.name}`;
        if (entry.id) out.push(path);
        else out.push(...(await walk(path, depth + 1)));
      }
      if (!data || data.length < PAGE) break;
    }
    return out;
  };
  return walk(`${agencyId}/${propertyId}`, 0);
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
