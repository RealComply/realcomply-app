import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/data/current-profile";
import { endedEmail } from "@/lib/subscription-end/emails";
import { buildCertificatePdf } from "@/lib/subscription-end/certificate";
import { activityDeleteAfter } from "@/lib/subscription-end/dates";

// Staff-only previews of the two subscription-end emails and the deletion
// certificate, with a made-up office, so the wording and layout can be
// checked without ending a subscription. Nothing is sent and nothing is read
// from the database.
//
//   /dashboard/admin/subscription-end-preview?kind=day0
//   /dashboard/admin/subscription-end-preview?kind=day7
//   /dashboard/admin/subscription-end-preview?kind=certificate
export async function GET(request: Request) {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) notFound();

  const kind = new URL(request.url).searchParams.get("kind") ?? "day0";
  const endedAt = new Date("2026-10-08T05:00:00Z");

  if (kind === "certificate") {
    const pdf = await buildCertificatePdf({
      certificateNumber: "DEL-2026-0001",
      subscriberName: "Harbour & Vale Realty (sample)",
      endedAt,
      deletedAt: new Date("2026-10-21T15:00:00Z"),
      counts: {
        listings: 17,
        pm_properties: 0,
        documents: 412,
        gifts: 12,
        complaints: 1,
        breaches: 0,
        training_and_cpd: 38,
        licence_records: 6,
        trust_reconciliations: 24,
        trust_audits: 2,
        other_signoff_documents: 3,
        user_accounts: 5,
      },
      activityDeleteAfter: activityDeleteAfter(endedAt),
    });
    return new Response(pdf as BodyInit, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  }

  const message = endedEmail(kind === "day7" ? "day7" : "day0", {
    agencyName: "Harbour & Vale Realty (sample)",
    endedAt,
    now: kind === "day7" ? new Date("2026-10-14T15:00:00Z") : endedAt,
  });
  const page = `<!doctype html><meta charset="utf-8"><title>${message.subject}</title>
<div style="font:13px -apple-system,sans-serif;padding:10px 14px;background:#fff8e6;border-bottom:1px solid #f0e0bd">
Subject: <b>${message.subject.replace(/</g, "&lt;")}</b></div>${message.html}`;
  return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
