import type { SupabaseClient } from "@supabase/supabase-js";
import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { buildSignoffPackPdf, type PackPdfInput } from "@/lib/pdf/signoff-pack";
import {
  GROUP_HEADINGS,
  GROUP_OF,
  PACK_TICK,
  grouped,
  monthName,
  packMonthFor,
  preparedLine,
  type Group,
  type ItemType,
  type WaitingItem,
} from "@/lib/licensee-signoff/model";
import { waitingItems } from "@/lib/licensee-signoff/waiting";
import { afterSigning, type Office } from "@/lib/licensee-signoff/server";

// The month's pack (Adam, 3 Nov 2026; 0109). Server only.

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const dayLabel = (iso: string) => formatAuDate(sydneyDate(new Date(iso)));

export type PackRow = {
  id: string;
  month: string;
  sent_at: string | null;
  sent_by_name: string | null;
  signed_at: string | null;
  signed_name: string | null;
  signed_via: string | null;
  signed_file_path: string | null;
  signed_file_name: string | null;
};

export type PackItem = {
  id: string;
  type: ItemType;
  itemId: string;
  group: Group;
  title: string;
  details: string;
  flagged: boolean;
  flagText: string | null;
  note: string | null;
  noteBy: string | null;
  heldBackAt: string | null;
  heldBackNote: string | null;
  signedAt: string | null;
};

/** A waiting item before the pack is sent: with the office manager's note and any earlier hold-back note. */
export type DraftItem = WaitingItem & { note: string | null; noteBy: string | null; heldBackNote: string | null };

const PACK_COLUMNS = "id, month, sent_at, sent_by_name, signed_at, signed_name, signed_via, signed_file_path, signed_file_name";

/** The office's packs: the one sent and waiting for the licensee, the last signed, and which months have gone. */
export async function packsFor(client: SupabaseClient, agencyId: string) {
  const { data } = await client
    .from("signoff_packs")
    .select(PACK_COLUMNS)
    .eq("agency_id", agencyId)
    .order("month", { ascending: false });
  const packs = (data ?? []) as PackRow[];
  return {
    open: packs.find((p) => p.sent_at && !p.signed_at) ?? null,
    lastSigned: packs.find((p) => p.signed_at) ?? null,
    signed: packs.filter((p) => p.signed_at),
    sentMonths: new Set(packs.filter((p) => p.sent_at).map((p) => p.month)),
  };
}

export function draftMonth(sentMonths: ReadonlySet<string>, now: Date = new Date()): string {
  return packMonthFor(sydneyDate(now), sentMonths);
}

export async function packItemsOf(client: SupabaseClient, agencyId: string, packId: string): Promise<PackItem[]> {
  const { data } = await client
    .from("signoff_pack_items")
    .select("*")
    .eq("agency_id", agencyId)
    .eq("pack_id", packId);
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    type: str(r.item_type) as ItemType,
    itemId: str(r.item_id),
    group: str(r.grp) as Group,
    title: str(r.title),
    details: str(r.details),
    flagged: r.flagged === true,
    flagText: (r.flag_text as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    noteBy: (r.note_by_name as string | null) ?? null,
    heldBackAt: (r.held_back_at as string | null) ?? null,
    heldBackNote: (r.held_back_note as string | null) ?? null,
    signedAt: (r.signed_at as string | null) ?? null,
  }));
}

/** Everything waiting now, not already in a sent pack, with notes. */
export async function draftItems(client: SupabaseClient, agencyId: string): Promise<DraftItem[]> {
  const [items, { data: notes }, { data: held }] = await Promise.all([
    waitingItems(client, agencyId, { excludeInSentPacks: true }),
    client.from("signoff_item_notes").select("item_type, item_id, note, noted_by_name").eq("agency_id", agencyId),
    client
      .from("signoff_pack_items")
      .select("item_type, item_id, held_back_note, held_back_at")
      .eq("agency_id", agencyId)
      .not("held_back_at", "is", null)
      .order("held_back_at", { ascending: false }),
  ]);
  const noteOf = new Map(((notes ?? []) as Row[]).map((n) => [`${str(n.item_type)}:${str(n.item_id)}`, n]));
  const heldOf = new Map<string, string>();
  for (const h of (held ?? []) as Row[]) {
    const key = `${str(h.item_type)}:${str(h.item_id)}`;
    if (!heldOf.has(key)) heldOf.set(key, str(h.held_back_note));
  }
  return items.map((i) => {
    const n = noteOf.get(`${i.type}:${i.id}`);
    return {
      ...i,
      note: n ? str(n.note) : null,
      noteBy: n ? str(n.noted_by_name) || null : null,
      heldBackNote: heldOf.get(`${i.type}:${i.id}`) ?? null,
    };
  });
}

/**
 * Sends the month's pack: fixed from here, so anything that comes in after
 * goes into next month's. A row made earlier for the month's reminder is
 * reused. Returns the pack's id.
 */
export async function createPack(
  service: SupabaseClient,
  p: { agencyId: string; month: string; items: DraftItem[]; sender: { id: string; name: string } },
): Promise<string> {
  const now = new Date().toISOString();
  const { data: existing } = await service
    .from("signoff_packs")
    .select("id, sent_at")
    .eq("agency_id", p.agencyId)
    .eq("month", p.month)
    .maybeSingle();
  if ((existing as Row | null)?.sent_at) throw new Error(`${monthName(p.month)}'s pack has already been sent.`);
  let packId = str((existing as Row | null)?.id);
  if (packId) {
    const { error } = await service
      .from("signoff_packs")
      .update({ sent_at: now, sent_by: p.sender.id, sent_by_name: p.sender.name })
      .eq("id", packId)
      .is("sent_at", null);
    if (error) throw new Error("Couldn't send the pack just now. Try again.");
  } else {
    const { data, error } = await service
      .from("signoff_packs")
      .insert({ agency_id: p.agencyId, month: p.month, sent_at: now, sent_by: p.sender.id, sent_by_name: p.sender.name })
      .select("id")
      .maybeSingle();
    if (error || !data) throw new Error("Couldn't send the pack just now. Try again.");
    packId = str((data as Row).id);
  }
  if (p.items.length > 0) {
    const { error } = await service.from("signoff_pack_items").insert(
      p.items.map((i) => ({
        pack_id: packId,
        agency_id: p.agencyId,
        item_type: i.type,
        item_id: i.id,
        grp: GROUP_OF[i.type],
        title: i.title,
        details: i.details,
        flagged: i.flagged,
        flag_text: i.flagText,
        note: i.note,
        note_by_name: i.noteBy,
      })),
    );
    if (error) {
      await service.from("signoff_packs").update({ sent_at: null, sent_by: null, sent_by_name: null }).eq("id", packId);
      throw new Error("Couldn't send the pack just now. Try again.");
    }
  }
  // The notes went into the pack with their items.
  const noted = p.items.filter((i) => i.note).map((i) => i.id);
  if (noted.length > 0) await service.from("signoff_item_notes").delete().eq("agency_id", p.agencyId).in("item_id", noted);
  return packId;
}

/**
 * Signs the pack: every item not held back, each in its own place
 * (licensee_sign_pack, 0109), then the signed copies of trust and SG Manual
 * documents, then the signed pack PDF, filed in Sign-offs.
 */
export async function signPack(
  service: SupabaseClient,
  p: {
    office: Office;
    pack: PackRow;
    signerId: string;
    name: string;
    via: "app";
    holds: Array<{ id: string; note: string }>;
  },
): Promise<{ signed: number; held: number; skipped: number }> {
  const { data, error } = await service.rpc("licensee_sign_pack", {
    p_pack: p.pack.id,
    p_signer: p.signerId,
    p_name: p.name,
    p_via: p.via,
    p_hold: p.holds,
  });
  if (error) {
    throw new Error(error.code === "P0001" ? error.message : "Couldn't sign the pack just now. Try again.");
  }
  const result = (Array.isArray(data) ? data[0] : data) as { signed: number; held: number; skipped: number };
  const items = await packItemsOf(service, p.office.id, p.pack.id);
  await afterSigning(
    service,
    p.office.id,
    items.filter((i) => i.signedAt).map((i) => ({ type: i.type, id: i.itemId })),
  );
  try {
    const { data: after } = await service.from("signoff_packs").select(PACK_COLUMNS).eq("id", p.pack.id).maybeSingle();
    const bytes = await buildSignoffPackPdf(packPdfInput(p.office, after as PackRow, items));
    const path = `${p.office.id}/_signoffs/packs/${p.pack.month}-sign-off-pack-signed.pdf`;
    const name = `${monthName(p.pack.month)} ${p.pack.month.slice(0, 4)} sign-off pack (signed).pdf`;
    const { error: up } = await service.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (!up) await service.from("signoff_packs").update({ signed_file_path: path, signed_file_name: name }).eq("id", p.pack.id);
    else console.error("signed pack: upload failed", up.message);
  } catch (err) {
    console.error("signed pack: PDF not built", err instanceof Error ? err.message : err);
  }
  return result;
}

/** What the PDF shows, for a draft (no pack yet), a sent pack, or a signed one. */
export function packPdfInput(
  office: Office,
  pack: PackRow | null,
  items: Array<PackItem | DraftItem>,
  draft?: { month: string; preparer: { name: string; officeManager: boolean } },
): PackPdfInput {
  const month = pack?.month ?? draft?.month ?? "";
  const rows = items.map((i) => {
    const packItem = "heldBackAt" in i ? (i as PackItem) : null;
    return {
      group: i.group,
      flagged: i.flagged,
      at: "at" in i ? (i as DraftItem).at : i.title,
      title: i.title,
      pdf: {
        title: i.title,
        details: i.details,
        flagText: i.flagText,
        note: i.note,
        noteBy: i.noteBy,
        heldBackNote: packItem ? (packItem.heldBackAt ? packItem.heldBackNote : null) : (i as DraftItem).heldBackNote,
        outcome: pack?.signed_at && packItem
          ? packItem.signedAt
            ? ("signed" as const)
            : packItem.heldBackAt
              ? ("held" as const)
              : ("already" as const)
          : null,
      },
    };
  });
  const signed = pack?.signed_at
    ? {
        name: pack.signed_name ?? office.licensee.name,
        dateLabel: dayLabel(pack.signed_at),
        tick: PACK_TICK,
        signedCount: rows.filter((r) => r.pdf.outcome === "signed").length,
        heldCount: rows.filter((r) => r.pdf.outcome === "held").length,
        how: "in RealComply",
      }
    : null;
  return {
    officeName: office.name,
    month,
    licenseeName: office.licensee.name,
    preparedLine: draft ? preparedLine(month, office.licensee.name, draft.preparer) : null,
    sentLine: pack?.sent_at ? `Sent by ${pack.sent_by_name ?? "the office"} on ${dayLabel(pack.sent_at)}.` : null,
    groups: grouped(rows).map((g) => ({ heading: GROUP_HEADINGS[g.group], items: g.items.map((r) => r.pdf) })),
    signature: signed,
  };
}
