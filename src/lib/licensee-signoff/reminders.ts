import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email/send";
import { appBaseUrl } from "@/lib/site-url";
import { sydneyDate } from "@/lib/subscription-end/dates";
import { buildSendPackReminder, buildSignPackReminder } from "@/lib/email/licensee-signoff";
import { createLicenseeLink, emailLicenseeLink, licenseeLinkUrl, officeFor } from "@/lib/licensee-signoff/server";
import { draftItems, draftMonth, packsFor } from "@/lib/licensee-signoff/pack";

// The "Monthly pack" reminders (Adam, 3 Nov 2026; 0109): "On the 1st of each
// month the office manager is reminded to send the pack. If the licensee
// hasn't signed it within 7 days, they get a reminder." Only offices set to
// "Monthly pack"; each reminder goes once (recorded on the month's pack).

const SEVEN_DAYS = 7 * 86400_000;

export type ReminderResult = { offices: number; sendReminders: number; signReminders: number; failed: number };

export async function sendPackReminders(service: SupabaseClient, now: Date = new Date()): Promise<ReminderResult> {
  const result: ReminderResult = { offices: 0, sendReminders: 0, signReminders: 0, failed: 0 };
  const { data: agencies } = await service
    .from("agencies")
    .select("id, plan, ended_at")
    .eq("licensee_signoff_mode", "monthly")
    .is("ended_at", null);
  const today = sydneyDate(now);
  for (const a of (agencies ?? []) as Array<{ id: string; plan: string | null }>) {
    if (String(a.plan ?? "").startsWith("agent_")) continue;
    result.offices += 1;
    try {
      const office = await officeFor(service, a.id);
      if (!office) continue;
      const packs = await packsFor(service, a.id);

      // The 1st (or the first run after it, to the 3rd): time to send last month's pack.
      if (Number(today.slice(8, 10)) <= 3 && !packs.open) {
        const month = draftMonth(packs.sentMonths, now);
        const { data: row } = await service
          .from("signoff_packs")
          .select("id, office_reminded_at")
          .eq("agency_id", a.id)
          .eq("month", month)
          .maybeSingle();
        const items = await draftItems(service, a.id);
        if (!(row as { office_reminded_at?: string | null } | null)?.office_reminded_at && items.length > 0) {
          const people = office.officeManagers.length
            ? office.officeManagers
            : office.licensee.profileId && office.licensee.email
              ? [{ id: office.licensee.profileId, name: office.licensee.name, email: office.licensee.email }]
              : [];
          let sent = false;
          for (const p of people) {
            if (!p.email) continue;
            const email = buildSendPackReminder({
              name: p.name,
              officeName: office.name,
              month,
              n: items.length,
              url: `${appBaseUrl()}/dashboard/licensee-signoff`,
            });
            sent = (await sendEmail({ to: p.email, ...email })) || sent;
          }
          if (sent) {
            const stamp = { office_reminded_at: now.toISOString() };
            if (row) await service.from("signoff_packs").update(stamp).eq("id", (row as { id: string }).id);
            else await service.from("signoff_packs").insert({ agency_id: a.id, month, ...stamp });
            result.sendReminders += 1;
          }
        }
      }

      // A pack sent 7 days ago and not signed: the licensee, with a fresh link.
      const open = packs.open;
      if (open?.sent_at && now.getTime() - Date.parse(open.sent_at) >= SEVEN_DAYS && office.licensee.email) {
        const { data: row } = await service.from("signoff_packs").select("licensee_reminded_at").eq("id", open.id).maybeSingle();
        if (!(row as { licensee_reminded_at?: string | null } | null)?.licensee_reminded_at) {
          const { count } = await service
            .from("signoff_pack_items")
            .select("id", { count: "exact", head: true })
            .eq("pack_id", open.id);
          const link = await createLicenseeLink(service, {
            agencyId: a.id,
            purpose: "pack",
            packId: open.id,
            sentTo: office.licensee.email,
            licenseeName: office.licensee.name,
            createdBy: null,
          });
          if (link) {
            const email = buildSignPackReminder({
              licenseeName: office.licensee.name,
              officeName: office.name,
              month: open.month,
              n: count ?? 0,
              url: licenseeLinkUrl(link.token),
            });
            if (await emailLicenseeLink(service, link.id, { to: office.licensee.email, ...email })) {
              await service.from("signoff_packs").update({ licensee_reminded_at: now.toISOString() }).eq("id", open.id);
              result.signReminders += 1;
            } else result.failed += 1;
          }
        }
      }
    } catch (err) {
      console.error("licensee sign-off reminders: office failed", a.id, err instanceof Error ? err.message : err);
      result.failed += 1;
    }
  }
  return result;
}
