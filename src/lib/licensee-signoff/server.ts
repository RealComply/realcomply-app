import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { appBaseUrl } from "@/lib/site-url";
import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { stampSignedCopy } from "@/lib/signoff/stamp";
import { buildItemLinkEmail, buildPackEmail } from "@/lib/email/licensee-signoff";
import { countsByGroup, type ItemType, type SignoffMode } from "@/lib/licensee-signoff/model";
import { waitingItems } from "@/lib/licensee-signoff/waiting";

// The server's side of the licensee's sign-off (Adam, 3 Nov 2026; 0109).
// Server only: these read and write with full rights, and only after the
// caller has been checked (a signed-in licensee or office manager, or a live
// link's token). Every query names the office.

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export type Office = {
  id: string;
  name: string;
  agentPlan: boolean;
  mode: SignoffMode;
  /** The licensee in charge: their profile if they have a login, and the office's licensee email. */
  licensee: { name: string; email: string | null; profileId: string | null };
  officeManagers: Array<{ id: string; name: string; email: string | null }>;
};

export async function officeFor(service: SupabaseClient, agencyId: string): Promise<Office | null> {
  const [{ data: agency }, { data: people }, { data: managers }] = await Promise.all([
    service
      .from("agencies")
      .select("id, name, plan, licensee_name, licensee_email, licensee_signoff_mode")
      .eq("id", agencyId)
      .maybeSingle(),
    service
      .from("profiles")
      .select("id, full_name, email, is_licensee_in_charge, archived_at")
      .eq("agency_id", agencyId)
      .is("archived_at", null),
    service.from("office_managers").select("profile_id").eq("agency_id", agencyId).is("withdrawn_at", null),
  ]);
  if (!agency) return null;
  const a = agency as Row;
  const rows = (people ?? []) as Row[];
  const licensee = rows.find((p) => p.is_licensee_in_charge === true) ?? null;
  const omIds = new Set(((managers ?? []) as Row[]).map((m) => str(m.profile_id)));
  const nameOf = (p: Row) => str(p.full_name).trim() || str(p.email);
  return {
    id: str(a.id),
    name: str(a.name),
    agentPlan: str(a.plan).startsWith("agent_"),
    mode: a.licensee_signoff_mode === "monthly" ? "monthly" : "as_they_come",
    licensee: {
      name: (licensee ? nameOf(licensee) : str(a.licensee_name).trim()) || "your licensee in charge",
      email: licensee ? str(licensee.email) || null : str(a.licensee_email).trim() || null,
      profileId: licensee ? str(licensee.id) : null,
    },
    officeManagers: rows
      .filter((p) => omIds.has(str(p.id)))
      .map((p) => ({ id: str(p.id), name: nameOf(p), email: str(p.email) || null })),
  };
}

export const licenseeLinkUrl = (token: string) => `${appBaseUrl()}/licensee/${token}`;

/** A new link for one item or a pack. Any earlier live link for the same thing is withdrawn first. */
export async function createLicenseeLink(
  service: SupabaseClient,
  p: {
    agencyId: string;
    purpose: "item" | "pack";
    itemType?: ItemType;
    itemId?: string;
    packId?: string;
    sentTo: string;
    licenseeName: string;
    createdBy: string | null;
  },
): Promise<{ id: string; token: string } | null> {
  const live = service
    .from("licensee_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("agency_id", p.agencyId)
    .is("used_at", null)
    .is("revoked_at", null);
  await (p.purpose === "pack" ? live.eq("pack_id", p.packId ?? "") : live.eq("item_type", p.itemType ?? "").eq("item_id", p.itemId ?? ""));
  const { data, error } = await service
    .from("licensee_links")
    .insert({
      agency_id: p.agencyId,
      purpose: p.purpose,
      item_type: p.purpose === "item" ? p.itemType : null,
      item_id: p.purpose === "item" ? p.itemId : null,
      pack_id: p.purpose === "pack" ? p.packId : null,
      sent_to: p.sentTo,
      licensee_name: p.licenseeName,
      created_by: p.createdBy,
    })
    .select("id, token")
    .maybeSingle();
  if (error || !data) {
    console.error("licensee link: could not create", p.purpose, error?.message);
    return null;
  }
  return data as { id: string; token: string };
}

/** Sends a link's email and records how it went (as 0047 for sign-off links). */
export async function emailLicenseeLink(
  service: SupabaseClient,
  linkId: string,
  email: { to: string; subject: string; text: string; html: string; replyTo?: string },
): Promise<boolean> {
  const { data: before } = await service.from("licensee_links").select("email_attempts").eq("id", linkId).maybeSingle();
  const ok = await sendEmail({ to: email.to, subject: email.subject, text: email.text, html: email.html, replyTo: email.replyTo });
  await service
    .from("licensee_links")
    .update({
      email_attempts: Number((before as Row | null)?.email_attempts ?? 0) + 1,
      ...(ok ? { email_sent_at: new Date().toISOString(), email_error: null } : { email_error: "The email didn't send." }),
    })
    .eq("id", linkId);
  return ok;
}

/** The live link with this token, used or not, or null if there's no such link. */
export async function licenseeLinkByToken(service: SupabaseClient, token: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await service.from("licensee_links").select("*").eq("token", token).maybeSingle();
  return (data as Row | null) ?? null;
}

export function linkIsLive(link: Row, now: Date = new Date()): boolean {
  return !link.used_at && !link.revoked_at && Date.parse(str(link.expires_at)) > now.getTime();
}

/**
 * "As items come in" (Adam, 3 Nov 2026): a licensee with no login gets an
 * email link for each item as it is ready. Called after an item becomes
 * waiting (a reconciliation uploaded, the audit entered, a new SG Manual
 * version, a training plan signed by the staff member, a complaint resolved,
 * a gift over the limit recorded). Does nothing for an office set to
 * "Monthly pack" (it goes in the pack), an office whose licensee has a login
 * (they sign in the app), or an agent's own plan. Never throws: the upload or
 * save that called it has already succeeded.
 */
export async function offerItemLink(agencyId: string, type: Exclude<ItemType, "sales_file">, id: string, createdBy: string | null): Promise<void> {
  try {
    const service = createServiceClient();
    const office = await officeFor(service, agencyId);
    if (!office || office.agentPlan || office.mode !== "as_they_come" || office.licensee.profileId || !office.licensee.email) return;
    const item = (await waitingItems(service, agencyId)).find((i) => i.type === type && i.id === id);
    if (!item) return;
    const link = await createLicenseeLink(service, {
      agencyId,
      purpose: "item",
      itemType: type,
      itemId: id,
      sentTo: office.licensee.email,
      licenseeName: office.licensee.name,
      createdBy,
    });
    if (!link) return;
    const expires = formatAuDate(sydneyDate(new Date(Date.now() + 30 * 86400_000)));
    const email = buildItemLinkEmail({
      licenseeName: office.licensee.name,
      officeName: office.name,
      itemType: type,
      title: item.title,
      details: item.details,
      url: licenseeLinkUrl(link.token),
      expiresAt: expires,
    });
    await emailLicenseeLink(service, link.id, { to: office.licensee.email, ...email });
  } catch (err) {
    console.error("licensee item link: not offered", type, err instanceof Error ? err.message : err);
  }
}

/** Sends the pack's email with a fresh link (Adam, 3 Nov 2026). */
export async function emailPack(
  service: SupabaseClient,
  p: { office: Office; packId: string; month: string; senderName: string; senderEmail: string | null; createdBy: string | null },
): Promise<{ sent: boolean; linkId: string | null }> {
  if (!p.office.licensee.email) return { sent: false, linkId: null };
  const { data: items } = await service
    .from("signoff_pack_items")
    .select("grp, item_type, flagged")
    .eq("pack_id", p.packId)
    .eq("agency_id", p.office.id);
  const rows = ((items ?? []) as Array<{ grp: "sales" | "pm" | "trust" | "office"; item_type: string; flagged: boolean }>).map((r) => ({
    group: r.grp,
    type: r.item_type,
    flagged: r.flagged,
  }));
  const link = await createLicenseeLink(service, {
    agencyId: p.office.id,
    purpose: "pack",
    packId: p.packId,
    sentTo: p.office.licensee.email,
    licenseeName: p.office.licensee.name,
    createdBy: p.createdBy,
  });
  if (!link) return { sent: false, linkId: null };
  const email = buildPackEmail({
    licenseeName: p.office.licensee.name,
    senderName: p.senderName.trim().split(/\s+/)[0] || p.senderName,
    officeName: p.office.name,
    month: p.month,
    counts: countsByGroup(rows),
    total: rows.length,
    flagged: rows.filter((r) => r.flagged).length,
    trustAllReconciliations: rows.every((r) => r.group !== "trust" || r.type === "trust_reconciliation"),
    url: licenseeLinkUrl(link.token),
  });
  const sent = await emailLicenseeLink(service, link.id, {
    to: p.office.licensee.email,
    ...email,
    ...(p.senderEmail ? { replyTo: p.senderEmail } : {}),
  });
  return { sent, linkId: link.id };
}

/** After signing: the signed copies of trust reconciliations and SG Manual versions, as signing in the app makes. */
export async function afterSigning(service: SupabaseClient, agencyId: string, signed: Array<{ type: string; id: string }>): Promise<void> {
  const docIds = signed.filter((s) => s.type === "trust_reconciliation" || s.type === "sg_manual").map((s) => s.id);
  if (docIds.length === 0) return;
  const { data: docs } = await service
    .from("signoff_documents")
    .select("id, title, file_path, file_name, category")
    .eq("agency_id", agencyId)
    .in("id", docIds);
  for (const d of (docs ?? []) as Row[]) {
    await stampSignedCopy(() => service, {
      documentId: str(d.id),
      agencyId,
      title: str(d.title),
      filePath: str(d.file_path),
      fileName: str(d.file_name),
      category: str(d.category),
    });
  }
}
