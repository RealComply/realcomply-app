import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { appBaseUrl } from "@/lib/site-url";
import { stampSignedCopy } from "@/lib/signoff/stamp";
import { buildPackEmail } from "@/lib/email/licensee-signoff";
import { countsByGroup, type SignoffMode } from "@/lib/licensee-signoff/model";

// The server's side of the licensee's sign-off (Adam, 3 Nov 2026; 0109).
// Server only: these read and write with full rights, and only after the
// caller has been checked (a signed-in licensee or office manager). Every
// query names the office.

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

/** Where the licensee in charge signs the pack: in the app, logged in. */
export const packPageUrl = () => `${appBaseUrl()}/dashboard/licensee-signoff`;

/**
 * Emails the licensee in charge that the month's pack is ready (Adam, 3 Nov
 * 2026). Only a licensee with a login: they sign it in the app. A licensee
 * with no login can't be sent a pack (Master, 4 Nov 2026: their links are a
 * separate change), so this sends nothing for them.
 */
export async function emailPack(
  service: SupabaseClient,
  p: { office: Office; packId: string; month: string; senderName: string; senderEmail: string | null },
): Promise<{ sent: boolean }> {
  if (!p.office.licensee.profileId || !p.office.licensee.email) return { sent: false };
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
  const email = buildPackEmail({
    licenseeName: p.office.licensee.name,
    senderName: p.senderName.trim().split(/\s+/)[0] || p.senderName,
    officeName: p.office.name,
    month: p.month,
    counts: countsByGroup(rows),
    total: rows.length,
    flagged: rows.filter((r) => r.flagged).length,
    trustAllReconciliations: rows.every((r) => r.group !== "trust" || r.type === "trust_reconciliation"),
    url: packPageUrl(),
  });
  const sent = await sendEmail({
    to: p.office.licensee.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
    ...(p.senderEmail ? { replyTo: p.senderEmail } : {}),
  });
  return { sent };
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
