import type { SupabaseClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET, isInFolder } from "@/lib/storage/evidence";
import { comparablesFor, type Comparable } from "@/lib/data/comparables";
import { espRevisionsFor } from "@/lib/data/esp-revisions";
import { revisionsOrCard, type EspRevision } from "@/lib/esp-history";
import { areaOf, type AreaKind } from "@/lib/rules/council-area";
import { comparablesRecordOf } from "@/lib/rules/comparables-rules";
import {
  linkStoppedBecause,
  soiApplies,
  soiContentOf,
  soiDraft,
  soiReviseBy,
  type SoiDraft,
  type SoiLink,
  type SoiVersion,
} from "@/lib/rules/soi";
import type { Property, PropertyItem } from "@/lib/types";

// The Statement of Information on a listing (0121): every version, the link
// for online ads, and the form filled from the file. Before 0121 runs, the
// tables aren't there: every read comes back empty and the card shows as it
// would on a listing with nothing on it yet.

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

/** The public address of a listing's statement. */
export const soiPublicUrl = (token: string) => `${SITE_URL}/soi/${token}`;

/** Every version, oldest first. */
export async function soiVersionsFor(supabase: SupabaseClient, propertyId: string): Promise<SoiVersion[]> {
  const { data, error } = await supabase
    .from("statements_of_information")
    .select("version_no, source, pdf_path, file_name, content, esp_revision_no, prepared_on, prepared_by_name, created_at")
    .eq("property_id", propertyId)
    .order("version_no", { ascending: true });
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    versionNo: Number(r.version_no),
    source: r.source === "realcomply" ? "realcomply" : "uploaded",
    pdfPath: String(r.pdf_path),
    fileName: typeof r.file_name === "string" ? r.file_name : null,
    content: soiContentOf(r.content),
    espRevisionNo: typeof r.esp_revision_no === "number" ? r.esp_revision_no : null,
    preparedOn: String(r.prepared_on),
    preparedByName: typeof r.prepared_by_name === "string" ? r.prepared_by_name : null,
    createdAt: String(r.created_at),
  }));
}

/** The listing's link for online ads, or null when none has been switched on. */
export async function soiLinkFor(supabase: SupabaseClient, propertyId: string): Promise<SoiLink | null> {
  const { data, error } = await supabase
    .from("statement_of_information_links")
    .select("token, enabled, changed_at, changed_by_name")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { token: string; enabled: boolean; changed_at: string | null; changed_by_name: string | null };
  return { token: r.token, enabled: r.enabled, changedAt: r.changed_at, changedByName: r.changed_by_name };
}

/** The listing's 3 most comparable, as the agreement's ESP was worked out from (0119). */
export const firstEspAddresses = (listing: Comparable[]) => listing.filter((c) => c.mostComparable).map((c) => c.address);

/** When the latest statement must be revised by (Reg s12I), from the versions and the ESP revisions. */
export function reviseByFor(versions: SoiVersion[], revisions: EspRevision[], listing: Comparable[]) {
  return soiReviseBy({
    versions: versions.map((v) => ({ versionNo: v.versionNo, espRevisionNo: v.espRevisionNo })),
    revisions: revisions.map((r) => ({ no: r.no, givenOn: r.givenOn, recordedAt: r.recordedAt, comparables: r.comparables })),
    firstEsp: firstEspAddresses(listing),
  });
}

/** The form, filled from the listing's records. */
export function draftFor(input: {
  property: Pick<Property, "property_type">;
  allItems: Record<string, PropertyItem | undefined>;
  listing: Comparable[];
  revisions: EspRevision[];
  versions: SoiVersion[];
}): SoiDraft {
  const entries = ((input.allItems["f3"]?.data ?? {}) as { entries?: Array<{ pestInspection?: boolean; buildingInspection?: boolean; strata?: boolean }> })
    .entries ?? [];
  const previous = [...input.versions].reverse().find((v) => v.content)?.content ?? null;
  return soiDraft({
    propertyType: input.property.property_type ?? null,
    listing: input.listing.map((c) => ({
      address: c.address,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      bedrooms: c.bedrooms,
      bathrooms: c.bathrooms,
      carSpaces: c.carSpaces,
      landSizeSqm: c.landSizeSqm,
      internalAreaSqm: c.internalAreaSqm,
      mostComparable: c.mostComparable,
      mostComparableReason: c.mostComparableReason,
    })),
    firstEspFewerReason: comparablesRecordOf(input.allItems["a4c"]?.data).fewerThanThreeReason,
    revisions: input.revisions,
    previous,
    register: {
      building: entries.some((e) => e.buildingInspection === true),
      pest: entries.some((e) => e.pestInspection === true),
      strata: entries.some((e) => e.strata === true),
    },
  });
}

/** What the card shows. */
export type SoiView = {
  agencyId: string;
  propertyId: string;
  /** s72C covers the listing's agreement (from 8 February 2027). */
  applies: boolean;
  /** Signed off or withdrawn from sale: the versions only, nothing to change. */
  readOnly: boolean;
  address: string;
  area: AreaKind | null;
  /** Who it will say prepared it: the person looking, and their office. */
  preparedBy: string;
  versions: Array<SoiVersion & { url: string | null }>;
  draft: SoiDraft;
  reviseBy: { revisionNo: number; revisedOn: string; dueBy: string } | null;
  link: SoiLink | null;
  linkUrl: string | null;
  /** Why the link isn't showing the statement, when it isn't. */
  linkStopped: string | null;
  /** Revisions there are: what an uploaded one can be for. */
  revisionNos: number[];
};

export async function soiViewFor(
  supabase: SupabaseClient,
  input: {
    property: Pick<Property, "id" | "agency_id" | "address" | "property_type" | "council_area" | "stage">;
    allItems: Record<string, PropertyItem | undefined>;
    preparedBy: string;
    withdrawn: boolean;
    signedOff: boolean;
  },
): Promise<SoiView> {
  const p = input.property;
  const [versions, link, listing, stored] = await Promise.all([
    soiVersionsFor(supabase, p.id),
    soiLinkFor(supabase, p.id),
    comparablesFor(supabase, p.id),
    espRevisionsFor(supabase, p.agency_id, p.id),
  ]);
  const revisions = revisionsOrCard(stored, input.allItems["d3"]);
  const folder = `${p.agency_id}/${p.id}/soi/`;
  const paths = versions.map((v) => v.pdfPath).filter((path) => isInFolder(path, folder));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls(paths, 3600);
    for (const f of data ?? []) if (f.path && f.signedUrl) urls[f.path] = f.signedUrl;
  }
  return {
    agencyId: p.agency_id,
    propertyId: p.id,
    applies: soiApplies(input.allItems["a3"]?.event_date ?? null),
    readOnly: input.withdrawn || input.signedOff,
    address: p.address,
    area: areaOf(p.council_area),
    preparedBy: input.preparedBy,
    versions: [...versions].reverse().map((v) => ({ ...v, url: urls[v.pdfPath] ?? null })),
    draft: draftFor({ property: p, allItems: input.allItems, listing, revisions, versions }),
    reviseBy: reviseByFor(versions, revisions, listing),
    link,
    linkUrl: link ? soiPublicUrl(link.token) : null,
    linkStopped: link
      ? linkStoppedBecause({
          enabled: link.enabled,
          hasVersion: versions.length > 0,
          withdrawn: input.withdrawn,
          storedStage: p.stage,
          signedOff: input.signedOff,
        })
      : null,
    revisionNos: revisions.map((r) => r.no),
  };
}
