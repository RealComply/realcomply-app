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
import { comparablesFor } from "@/lib/data/comparables";
import { addressKey, previousAddresses, type RevisionCandidate } from "@/lib/rules/revision-comparables";

// The listing's ESP revisions (esp_revisions, 0110), oldest first, read with
// the caller's own access. Before 0110 runs this reads nothing, and the card
// shows what it holds as Revision 1 (revisionsOrCard).

export async function espRevisionsFor(supabase: SupabaseClient, agencyId: string, propertyId: string): Promise<EspRevision[]> {
  const { data, error } = await supabase
    .from("esp_revisions")
    .select(
      "revision_no, esp_low, esp_high, notice_given_on, notice_path, notice_file_name, entered_manually, recorded_by_name, recorded_at, previous_esp_low, previous_esp_high, evidence_path, evidence_file_name, evidence_in_notice, market_feedback, comparables, comparables_info_used, comparables_fewer_reason",
    )
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
  // The price statement cancellations (0100), so the card can say, before a
  // revision is deleted, that recording it cancelled the approval (0124).
  const { data: cancelled } = await supabase
    .from("listing_signoff_cancellations")
    .select("because_item_key, cancelled_at")
    .eq("property_id", propertyId)
    .eq("item_key", "b4");
  const cancellations = ((cancelled ?? []) as Array<{ because_item_key: string | null; cancelled_at: string }>).map((c) => ({
    becauseItemKey: c.because_item_key,
    cancelledAt: c.cancelled_at,
  }));
  const a4 = (allItems["a4"]?.data ?? {}) as { espLow?: unknown; espHigh?: unknown };
  const a3 = allItems["a3"];
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const agreementFile = a3?.evidence_path ? { path: a3.evidence_path, name: fileNameOf(a3.data, a3.evidence_path) } : null;
  const versions = espVersions(
    { low: num(a4.espLow), high: num(a4.espHigh), agreementDate: a3?.event_date ?? null, file: agreementFile },
    revisions,
    cancellations,
  );
  const folder = `${agencyId}/${propertyId}`;
  const pending = pendingFrom(allItems["d3"]?.data);
  const paths = [
    ...revisions.map((r) => r.noticePath),
    ...revisions.map((r) => r.evidencePath).filter((p): p is string => typeof p === "string"),
    ...revisions.map((r) => r.marketFeedbackRecord?.file?.path).filter((p): p is string => typeof p === "string"),
    ...(agreementFile ? [agreementFile.path] : []),
    ...(pending ? [pending.path] : []),
  ].filter((p) => isInFolder(p, folder));
  const fileUrls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrls([...new Set(paths)], 3600);
    for (const f of data ?? []) if (f.path && f.signedUrl) fileUrls[f.path] = f.signedUrl;
  }
  const last = revisions.length > 0 ? revisions[revisions.length - 1] : null;

  // For the next revision's comparable sales (Reg s12G(1)(a), (c); 0120):
  // the sales to choose from (the listing's own, then any an earlier
  // revision added), and the ones the previous ESP was worked out from.
  const listing = await comparablesFor(supabase, propertyId);
  const candidates: RevisionCandidate[] = [];
  const seen = new Set<string>();
  const offer = (c: RevisionCandidate) => {
    const key = addressKey(c.address);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };
  for (const c of listing) {
    offer({ key: `listing-${c.id}`, address: c.address, soldOn: c.saleDate?.slice(0, 10) ?? null, soldPrice: c.salePrice, distanceM: c.distanceM });
  }
  for (const r of [...revisions].reverse()) {
    for (const c of r.comparables ?? []) {
      offer({ key: `revision-${r.no}-${addressKey(c.address)}`, address: c.address, soldOn: c.soldOn, soldPrice: c.soldPrice, distanceM: c.distanceM });
    }
  }
  const firstEsp = listing.filter((c) => c.weighting === "relied").map((c) => c.address);

  return {
    revisionComparables: {
      candidates,
      previousAddresses: previousAddresses(revisions, firstEsp),
    },
    versions,
    fileUrls,
    latestNo: last ? last.no : null,
    // The ESP on file now, which a new revision's notice should give as the
    // ESP before it (s72A(5)(b)(i); 9 Nov 2026).
    currentEsp: last ? { low: last.low, high: last.high } : { low: num(a4.espLow), high: num(a4.espHigh) },
  };
}
