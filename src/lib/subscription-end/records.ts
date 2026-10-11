import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { listAllObjects } from "@/lib/backup/storage-backup";
import { safeZipName } from "@/lib/zip/store-zip";
import { STAGE_LABELS, type Profile, type PropertyStage } from "@/lib/types";
import { endedStateFor, type EndedState } from "./access";

// What the records page reads, and the manifest "Download all records" is
// built from.
//
// WHY THE SERVICE CLIENT, here and only here in the signed-in app. RLS lets an
// ordinary agent see only their own listings and keeps agency-wide registers
// to the licensee in charge (DPA cl 4.2). The account holder is not always the
// licensee: on an individual agent plan they are the agent. They are still
// the subscriber, and the records are theirs to take away in full. So
// recordsAccess() checks, on the server, that the caller is signed in, that
// their agency has ended, and that they are the licensee in charge or the
// account holder. Only then is the service client handed back, and every
// query below is filtered to that one agency id.

export type RecordsAccess = {
  profile: Profile;
  state: EndedState;
  service: SupabaseClient;
};

export async function recordsAccess(): Promise<RecordsAccess | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return null;

  const state = await endedStateFor(supabase, profile as Profile);
  if (!state || !state.mayUseRecords) return null;

  return { profile: profile as Profile, state, service: createServiceClient() };
}

export type RecordsListing = { id: string; address: string; stageLabel: string; createdAt: string };

export async function listingsFor(service: SupabaseClient, agencyId: string): Promise<RecordsListing[]> {
  const { data } = await service
    .from("properties")
    .select("id, address, stage, created_at")
    .eq("agency_id", agencyId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Array<{ id: string; address: string; stage: number; created_at: string }>).map((p) => ({
    id: p.id,
    address: p.address,
    stageLabel: STAGE_LABELS[p.stage as PropertyStage] ?? "",
    createdAt: p.created_at,
  }));
}

// ── The manifest ───────────────────────────────────────────────────────────

export type Manifest = {
  agencyName: string;
  listings: Array<{ id: string; folder: string }>;
  files: Array<{ zipPath: string; url: string }>;
  csv: Array<{ zipPath: string; content: string }>;
};

const FOLDERS: Record<string, string> = {
  _licences: "Licences",
  _cpd: "CPD",
  _brand: "Agency logo",
  "_sg-manual": "Statement of generic matters",
  _signoffs: "Signed-off documents",
  _pending: "Unsaved uploads",
};

/**
 * Everything in one agency's records, as instructions for the browser: which
 * audit packs to fetch, which files to fetch (by short-lived signed URL), and
 * the registers as CSV text. The browser builds the zip, so nothing large
 * passes through a server function with a size or time limit.
 */
export async function buildManifest(service: SupabaseClient, agencyId: string, agencyName: string): Promise<Manifest> {
  const listings = await listingsFor(service, agencyId);
  const folderFor = new Map<string, string>();
  const used = new Set<string>();
  for (const l of listings) {
    let folder = safeZipName(l.address);
    for (let n = 2; used.has(folder); n++) folder = `${safeZipName(l.address)} (${n})`;
    used.add(folder);
    folderFor.set(l.id, `Listings/${folder}`);
  }

  const { data: pmRows } = await service.from("pm_properties").select("id, address").eq("agency_id", agencyId);
  const pmFolder = new Map(
    ((pmRows ?? []) as Array<{ id: string; address: string }>).map((p) => [p.id, `Property management/${safeZipName(p.address)}`]),
  );

  // Files.
  const objects = await listAllObjects(service, agencyId);
  const paths = objects.map((o) => o.path);
  const files: Manifest["files"] = [];
  const zipNames = new Set<string>();
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100);
    const { data, error } = await service.storage.from(EVIDENCE_BUCKET).createSignedUrls(batch, 60 * 60);
    if (error) throw new Error(`could not sign file links: ${error.message}`);
    for (const signed of data ?? []) {
      if (!signed.signedUrl || !signed.path) continue;
      const base = zipPathFor(signed.path, folderFor, pmFolder);
      let zipPath = base;
      for (let n = 2; zipNames.has(zipPath); n++) zipPath = base.replace(/(\.[^./]*)?$/, ` (${n})$1`);
      zipNames.add(zipPath);
      files.push({ zipPath, url: signed.signedUrl });
    }
  }

  return {
    agencyName,
    listings: listings.map((l) => ({ id: l.id, folder: folderFor.get(l.id)! })),
    files,
    csv: await registersAsCsv(service, agencyId),
  };
}

function zipPathFor(path: string, listings: Map<string, string>, pm: Map<string, string>): string {
  const [, first, ...rest] = path.split("/");
  const tail = rest.map(safeZipName).join("/");
  const file = tail || safeZipName(first ?? "file");
  if (first && listings.has(first)) return `${listings.get(first)}/Documents/${tail}`;
  if (first && pm.has(first)) return `${pm.get(first)}/${tail}`;
  if (first && FOLDERS[first]) return `Documents/${FOLDERS[first]}/${tail}`;
  return `Documents/Other/${first ? `${safeZipName(first)}/` : ""}${file}`;
}

// ── The registers, as CSV ──────────────────────────────────────────────────
//
// Complete rather than pretty: every column of every agency table, so nothing
// the agency recorded is left behind. A person's id is followed by their name
// so the files read without a lookup. Tokens (invites, sign-off links) are
// left out: they are keys, not records.

const TABLES: Array<{ table: string; file: string; order?: string }> = [
  { table: "properties", file: "Listings", order: "created_at" },
  { table: "property_items", file: "Listing checklist items", order: "created_at" },
  { table: "property_comparables", file: "Comparable sales", order: "created_at" },
  { table: "property_market_listings", file: "Competing listings", order: "created_at" },
  { table: "property_transfers", file: "Listing transfers", order: "moved_at" },
  { table: "property_signoff_requests", file: "Licensee sign-off links", order: "created_at" },
  { table: "gifts", file: "Gift register", order: "gift_date" },
  { table: "complaints", file: "Complaint register", order: "received_date" },
  { table: "breaches", file: "Breach register", order: "identified_date" },
  { table: "cpd_records", file: "CPD records", order: "completed_date" },
  { table: "cpd_year_signoffs", file: "CPD year sign-offs", order: "created_at" },
  { table: "training_sessions", file: "Training sessions", order: "session_date" },
  { table: "training_attendance", file: "Training attendance", order: "created_at" },
  { table: "training_plans", file: "Training plans", order: "created_at" },
  { table: "training_plan_items", file: "Training plan items", order: "created_at" },
  { table: "trust_accounts", file: "Trust accounts", order: "created_at" },
  { table: "trust_audits", file: "Trust account audits", order: "period_end" },
  { table: "signoff_documents", file: "Signed-off documents (incl. trust reconciliations)", order: "created_at" },
  { table: "signoff_signatures", file: "Signatures", order: "signed_at" },
  // Added with 0058 and missed here until 10 Oct 2026: the signature kept when
  // a signed document is replaced, and the record of what was deleted.
  { table: "signoff_signature_voids", file: "Replaced signatures", order: "voided_at" },
  { table: "deletion_log", file: "Deletions", order: "deleted_at" },
  { table: "sg_manual_versions", file: "Statement of generic matters versions", order: "created_at" },
  { table: "licence_history", file: "Licence history", order: "changed_at" },
  { table: "assistant_agents", file: "Assistants and their agents", order: "created_at" },
  { table: "pm_properties", file: "Property management - properties", order: "created_at" },
  { table: "pm_tenancies", file: "Property management - tenancies", order: "created_at" },
  { table: "pm_item_events", file: "Property management - every tick", order: "changed_at" },
  { table: "pm_group_moves", file: "Property management - group moves", order: "moved_at" },
  { table: "pm_records", file: "Property management - records", order: "recorded_at" },
];

const PERSON_COLUMNS = new Set([
  "created_by", "completed_by", "profile_id", "agent_id", "uploaded_by", "signer_id", "confirmed_by",
  "moved_by", "from_agent", "to_agent", "changed_by", "manager_id", "recorded_by", "response_given_by",
  "assistant_id", "review_requested_by", "attributes_confirmed_by", "invited_by", "archived_by",
  "voided_by", "deleted_by",
]);

async function registersAsCsv(service: SupabaseClient, agencyId: string): Promise<Manifest["csv"]> {
  const out: Manifest["csv"] = [];

  const { data: people } = await service.from("profiles").select("*").eq("agency_id", agencyId);
  const profiles = (people ?? []) as Array<Record<string, unknown>>;
  const names = new Map(profiles.map((p) => [String(p.id), String(p.full_name ?? p.email ?? "")]));

  const { data: agency } = await service.from("agencies").select("*").eq("id", agencyId).maybeSingle();
  if (agency) {
    const a = { ...(agency as Record<string, unknown>) };
    // Billing internals are RealComply's, not the agency's records.
    for (const k of ["stripe_customer_id", "stripe_subscription_id", "comped_by", "comped_reason", "comped_until"]) delete a[k];
    out.push({ zipPath: "Registers and records/Agency details, insurance and corporation licence.csv", content: toCsv([a], names) });
  }
  out.push({ zipPath: "Registers and records/Team and licences.csv", content: toCsv(profiles, names) });

  for (const { table, file, order } of TABLES) {
    let query = service.from(table).select("*").eq("agency_id", agencyId);
    if (order) query = query.order(order, { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`could not read ${table}: ${error.message}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) continue;
    out.push({ zipPath: `Registers and records/${file}.csv`, content: toCsv(rows, names) });
  }

  return out;
}

function toCsv(rows: Array<Record<string, unknown>>, names: Map<string, string>): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === "token") continue;
      if (!columns.includes(key)) {
        columns.push(key);
        if (PERSON_COLUMNS.has(key)) columns.push(`${key}_name`);
      }
    }
  }
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => {
          if (c.endsWith("_name") && PERSON_COLUMNS.has(c.slice(0, -5))) {
            const id = row[c.slice(0, -5)];
            return cell(id ? names.get(String(id)) ?? "" : "");
          }
          return cell(row[c]);
        })
        .join(","),
    );
  }
  // A byte-order mark so Excel opens names with accents correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}
