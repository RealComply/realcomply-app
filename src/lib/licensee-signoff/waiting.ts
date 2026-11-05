import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { monthLabel } from "@/lib/trust-account";
import { getItem } from "@/lib/rules/nsw-sales";
import { GROUP_OF, type ItemType, type WaitingItem } from "@/lib/licensee-signoff/model";

// Everything waiting for the licensee in charge's signature (Adam, 3 Nov
// 2026; 0109), read for one office. The same items licensee_item_waiting()
// (0109) checks again at signing, so nothing signed some other way in between
// is signed twice.
//
// Read with whatever client the caller has: the office manager or the
// licensee (both read all of it since 0108), or the server's own key. Every
// read names the office, so the server's key never reads another office's
// records.

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const day = (iso: string) => formatAuDate(sydneyDate(new Date(iso)));

export type WaitingOptions = {
  /** Items already in a pack that has been sent and not yet signed: left out, they're in that pack. */
  excludeInSentPacks?: boolean;
};

/** Everything waiting for the licensee, in no particular order (see model.grouped). */
export async function waitingItems(
  client: SupabaseClient,
  agencyId: string,
  opts: WaitingOptions = {},
): Promise<WaitingItem[]> {
  const [
    { data: people },
    { data: agency },
    { data: requests },
    { data: docs },
    { data: audits },
    { data: plans },
    { data: complaints },
    { data: gifts },
    { data: accounts },
  ] = await Promise.all([
    client.from("profiles").select("id, full_name, email, is_licensee_in_charge").eq("agency_id", agencyId),
    client.from("agencies").select("gift_threshold").eq("id", agencyId).maybeSingle(),
    client
      .from("property_signoff_requests")
      .select("id, property_id, created_at, item_key, signed_at, revoked_at")
      .eq("agency_id", agencyId)
      .is("signed_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    client
      .from("signoff_documents")
      .select("id, category, title, created_at, uploaded_by, period_month, trust_account_id")
      .eq("agency_id", agencyId)
      .in("category", ["trust_reconciliation", "sg_manual"])
      .order("created_at", { ascending: false }),
    client
      .from("trust_audits")
      .select("id, trust_account_id, period_end, entered_by_name, entered_at, confirmed_at")
      .eq("agency_id", agencyId)
      .not("entered_at", "is", null)
      .is("confirmed_at", null),
    client
      .from("training_plans")
      .select("id, profile_id, staff_signed_name, staff_signed_at, principal_signed_at")
      .eq("agency_id", agencyId)
      .not("staff_signed_at", "is", null)
      .is("principal_signed_at", null),
    client
      .from("complaints")
      .select("id, complainant, nature, resolved_date, resolved_at, status, signed_off_at")
      .eq("agency_id", agencyId)
      .eq("status", "resolved")
      .is("signed_off_at", null),
    client
      .from("gifts")
      .select("id, profile_id, gift_date, description, value, status, created_at")
      .eq("agency_id", agencyId)
      .eq("status", "flagged"),
    client.from("trust_accounts").select("id, name").eq("agency_id", agencyId),
  ]);

  const nameOf = new Map(
    ((people ?? []) as Row[]).map((p) => [str(p.id), str(p.full_name).trim() || str(p.email) || "Someone"]),
  );
  const licenseeIds = new Set(((people ?? []) as Row[]).filter((p) => p.is_licensee_in_charge).map((p) => str(p.id)));
  const accountName = new Map(((accounts ?? []) as Row[]).map((a) => [str(a.id), str(a.name)]));
  const items: WaitingItem[] = [];
  const push = (type: ItemType, i: Omit<WaitingItem, "type" | "group">) => items.push({ type, group: GROUP_OF[type], ...i });

  // Sales files: the newest open sign-off request on each listing.
  const newestByListing = new Map<string, Row>();
  for (const r of (requests ?? []) as Row[]) {
    if ((str(r.item_key) || "sign_licensee") !== "sign_licensee") continue;
    if (!newestByListing.has(str(r.property_id))) newestByListing.set(str(r.property_id), r);
  }
  if (newestByListing.size > 0) {
    const ids = [...newestByListing.keys()];
    const [{ data: listings }, { data: flaggedCards }] = await Promise.all([
      client.from("properties").select("id, address, created_by").eq("agency_id", agencyId).in("id", ids),
      client
        .from("property_items")
        .select("property_id, item_key, data")
        .eq("agency_id", agencyId)
        .eq("status", "flagged")
        .in("property_id", ids),
    ]);
    const listingOf = new Map(((listings ?? []) as Row[]).map((l) => [str(l.id), l]));
    const flagsOf = new Map<string, string[]>();
    for (const f of (flaggedCards ?? []) as Row[]) {
      const data = (f.data ?? {}) as { flagReason?: string; flagReasons?: string[] };
      const reason = data.flagReason ?? data.flagReasons?.[0] ?? getItem(str(f.item_key))?.label ?? "Flagged";
      flagsOf.set(str(f.property_id), [...(flagsOf.get(str(f.property_id)) ?? []), reason]);
    }
    const stage = getItem("sign_licensee")?.stage;
    for (const [propertyId, r] of newestByListing) {
      const l = listingOf.get(propertyId);
      if (!l) continue;
      const flags = flagsOf.get(propertyId) ?? [];
      push("sales_file", {
        id: str(r.id),
        title: str(l.address),
        details: `${nameOf.get(str(l.created_by)) ?? "Agent"} · sent for sign-off ${day(str(r.created_at))}`,
        flagged: flags.length > 0,
        flagText: flags.length > 0 ? `${flags.length === 1 ? "1 flag" : `${flags.length} flags`}: ${flags[0]}` : null,
        href: `/dashboard/${propertyId}${stage ? `?stage=${stage}` : ""}#card-sign_licensee`,
        at: str(r.created_at),
      });
    }
  }

  // Trust reconciliations (the newest upload for each month) and the SG
  // Manual (the newest version), unsigned by the licensee.
  const docRows = (docs ?? []) as Row[];
  const docIds = docRows.map((d) => str(d.id));
  const { data: sigs } =
    docIds.length > 0
      ? await client
          .from("signoff_signatures")
          .select("document_id, signer_id, signed_at")
          .eq("agency_id", agencyId)
          .in("document_id", docIds)
          .not("signed_at", "is", null)
      : { data: [] as Row[] };
  const signedDocs = new Set<string>();
  const licenseeSignedDocs = new Set<string>();
  for (const s of (sigs ?? []) as Row[]) {
    signedDocs.add(str(s.document_id));
    if (licenseeIds.has(str(s.signer_id))) licenseeSignedDocs.add(str(s.document_id));
  }
  const seenMonth = new Set<string>();
  let newestSg: Row | null = null;
  for (const d of docRows) {
    if (d.category === "sg_manual") {
      newestSg ??= d;
      continue;
    }
    const key = `${str(d.trust_account_id)}:${str(d.period_month)}`;
    if (!d.period_month || seenMonth.has(key)) continue;
    seenMonth.add(key);
    if (signedDocs.has(str(d.id))) continue;
    push("trust_reconciliation", {
      id: str(d.id),
      title: `${accountName.get(str(d.trust_account_id)) || "Trust account"}: ${monthLabel(str(d.period_month))} reconciliation`,
      details: `Uploaded by ${nameOf.get(str(d.uploaded_by)) ?? "someone in the office"} · ${day(str(d.created_at))}`,
      flagged: false,
      flagText: null,
      href: "/dashboard/trust",
      at: str(d.created_at),
    });
  }
  if (newestSg && !licenseeSignedDocs.has(str(newestSg.id))) {
    push("sg_manual", {
      id: str(newestSg.id),
      title: `SG Manual: ${str(newestSg.title)}`,
      details: `Published by ${nameOf.get(str(newestSg.uploaded_by)) ?? "someone in the office"} · ${day(str(newestSg.created_at))}`,
      flagged: false,
      flagText: null,
      href: "/dashboard/sg-manual",
      at: str(newestSg.created_at),
    });
  }

  for (const a of (audits ?? []) as Row[]) {
    push("trust_audit", {
      id: str(a.id),
      title: `${accountName.get(str(a.trust_account_id)) || "Trust account"}: audit to ${formatAuDate(str(a.period_end))}`,
      details: `Entered by ${str(a.entered_by_name) || "someone in the office"} · ${day(str(a.entered_at))}`,
      flagged: false,
      flagText: null,
      href: "/dashboard/trust",
      at: str(a.entered_at),
    });
  }

  for (const t of (plans ?? []) as Row[]) {
    push("training_plan", {
      id: str(t.id),
      title: `Training plan for ${nameOf.get(str(t.profile_id)) ?? "a staff member"}`,
      details: `Signed by ${str(t.staff_signed_name) || "the staff member"} · ${day(str(t.staff_signed_at))}`,
      flagged: false,
      flagText: null,
      href: "/dashboard/training-plans",
      at: str(t.staff_signed_at),
    });
  }

  for (const c of (complaints ?? []) as Row[]) {
    const resolved = str(c.resolved_at) || (c.resolved_date ? `${str(c.resolved_date)}T00:00:00+11:00` : "");
    push("complaint", {
      id: str(c.id),
      title: "Complaint resolved",
      details: `${str(c.nature)}${resolved ? ` · resolved ${day(resolved)}` : ""}`,
      flagged: false,
      flagText: null,
      href: "/dashboard/registers?tab=complaints",
      at: resolved || "",
    });
  }

  const threshold = Number((agency as Row | null)?.gift_threshold ?? 60);
  for (const g of (gifts ?? []) as Row[]) {
    const value = g.value == null ? null : Number(g.value);
    push("gift", {
      id: str(g.id),
      title: `Gift over $${threshold}`,
      details: `${nameOf.get(str(g.profile_id)) ?? "Staff member"} · ${str(g.description)}${value != null ? `, about $${value}` : ""} · ${formatAuDate(str(g.gift_date))}`,
      flagged: true,
      flagText: "Review",
      href: "/dashboard/registers?tab=gifts",
      at: str(g.created_at),
    });
  }

  if (!opts.excludeInSentPacks) return items;
  const { data: open } = await client
    .from("signoff_pack_items")
    .select("item_type, item_id, signoff_packs!inner(sent_at, signed_at)")
    .eq("agency_id", agencyId)
    .not("signoff_packs.sent_at", "is", null)
    .is("signoff_packs.signed_at", null);
  const inSentPack = new Set(((open ?? []) as Row[]).map((r) => `${str(r.item_type)}:${str(r.item_id)}`));
  return items.filter((i) => !inSentPack.has(`${i.type}:${i.id}`));
}

/**
 * Which month's pack each item was signed in, for the line on its own record
 * (Adam, 3 Nov 2026): "Signed by [name], [date], in the [Month] pack".
 * Read with the viewer's own access; nothing (an empty map) before 0109.
 */
export async function packMonthsOf(client: SupabaseClient, agencyId: string, itemIds: string[]): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const { data, error } = await client
    .from("signoff_pack_items")
    .select("item_id, signoff_packs!inner(month)")
    .eq("agency_id", agencyId)
    .in("item_id", itemIds)
    .not("signed_at", "is", null);
  if (error) return new Map();
  return new Map(
    ((data ?? []) as Array<{ item_id: string; signoff_packs: { month: string } | { month: string }[] }>).map((r) => [
      r.item_id,
      Array.isArray(r.signoff_packs) ? (r.signoff_packs[0]?.month ?? "") : r.signoff_packs.month,
    ]),
  );
}
