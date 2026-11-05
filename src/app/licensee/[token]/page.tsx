import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";
import { licenseeLinkByToken, linkIsLive, officeFor } from "@/lib/licensee-signoff/server";
import { dayLabel, packItemsOf, type PackRow } from "@/lib/licensee-signoff/pack";
import { waitingItems } from "@/lib/licensee-signoff/waiting";
import { grouped, monthName, type ItemType } from "@/lib/licensee-signoff/model";
import { COMPLAINT_SIGN_OFF_WORDS } from "@/lib/reviews/records";
import { PackReview, type ReviewItem } from "@/components/licensee-signoff/PackReview";
import { ItemSign } from "@/components/licensee-signoff/ItemSign";
import { LicenseeOpenedBeacon } from "@/components/licensee-signoff/LicenseeOpenedBeacon";
import { RoofMark } from "@/components/RoofMark";

// The licensee's emailed link (Adam, 3 Nov 2026; 0109): the month's pack, or
// one item, signed without logging in. The token is the only credential: the
// server checks it before reading anything, and reads only the one office's
// records. Never indexed.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign-off · RealComply", robots: { index: false, follow: false } };

/** What the licensee ticks for one item. The SG and reconciliation words are the app's own. */
const ITEM_TICK: Record<Exclude<ItemType, "sales_file">, string> = {
  trust_reconciliation: "I have reviewed this reconciliation and I'm signing it off.",
  trust_audit: "I've checked these audit details and I confirm them.",
  sg_manual: "I have read this document and I'm signing it off.",
  training_plan: "I've reviewed this training plan and I approve it.",
  complaint: COMPLAINT_SIGN_OFF_WORDS,
  gift: "I've reviewed this gift.",
};
const HAS_DOCUMENT = new Set<ItemType>(["sales_file", "trust_reconciliation", "trust_audit", "sg_manual"]);

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-10">
      <p className="text-lg font-extrabold tracking-tight text-rc-ink">
        <RoofMark />
        RealComply
      </p>
      {children}
    </main>
  );
}

function Notice({ title, line }: { title: string; line: string }) {
  return (
    <Shell>
      <section className="rounded-card border border-rc-border bg-white p-5 shadow-card">
        <h1 className="text-lg font-bold text-rc-ink">{title}</h1>
        <p className="mt-1 text-sm text-rc-muted">{line}</p>
      </section>
    </Shell>
  );
}

export default async function LicenseeLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const service = createServiceClient();
  const link = await licenseeLinkByToken(service, token);
  if (!link) return <Notice title="This link isn't valid" line="Check you used the whole link from the email, or ask the office to send it again." />;
  const office = await officeFor(service, String(link.agency_id));
  if (!office) return <Notice title="This link isn't valid" line="Ask the office to send it again." />;
  if (link.used_at) return <Notice title="Signed. Thank you." line={`Signed by ${String(link.used_name ?? office.licensee.name)}. You can close this page.`} />;
  if (!linkIsLive(link)) {
    return <Notice title="This link can't be used any more" line={`Ask ${office.name} to send a new one.`} />;
  }
  const today = dayLabel(new Date().toISOString());

  if (link.purpose === "pack") {
    const { data } = await service
      .from("signoff_packs")
      .select("id, month, sent_at, sent_by_name, signed_at, signed_name, signed_via, signed_file_path, signed_file_name")
      .eq("id", String(link.pack_id))
      .eq("agency_id", office.id)
      .maybeSingle();
    const pack = data as PackRow | null;
    if (!pack) return <Notice title="This pack can't be found" line={`Ask ${office.name} to send it again.`} />;
    if (pack.signed_at) return <Notice title="This pack is signed" line={`Signed by ${pack.signed_name ?? office.licensee.name} on ${dayLabel(pack.signed_at)}.`} />;
    const items = await packItemsOf(service, office.id, pack.id);
    const reviewItems: ReviewItem[] = grouped(items.map((i) => ({ ...i, at: i.title }))).flatMap((g) =>
      g.items.map((i) => ({
        id: i.id,
        group: i.group,
        title: i.title,
        details: i.details,
        flagged: i.flagged,
        flagText: i.flagText,
        note: i.note,
        noteBy: i.noteBy,
        openHref: HAS_DOCUMENT.has(i.type) ? `/licensee/${token}/open/${i.id}` : null,
        openLabel: i.type === "sales_file" ? "Audit pack" : "Open",
      })),
    );
    return (
      <Shell>
        <PackReview
          via="link"
          token={token}
          monthLabel={monthName(pack.month)}
          sentLine={pack.sent_at ? `Sent by ${pack.sent_by_name ?? office.name} on ${dayLabel(pack.sent_at)}.` : null}
          pdfHref={`/licensee/${token}/pdf`}
          items={reviewItems}
          licenseeName={office.licensee.name}
          todayLabel={today}
          agencyName={office.name}
        />
        <LicenseeOpenedBeacon token={token} />
      </Shell>
    );
  }

  // One item.
  const type = String(link.item_type) as Exclude<ItemType, "sales_file">;
  const item = (await waitingItems(service, office.id)).find((i) => i.type === type && i.id === String(link.item_id));
  if (!item) return <Notice title="Already signed" line="This has been signed already. You can close this page." />;
  const extra = await itemLines(service, office.id, type, item.id);
  return (
    <Shell>
      <section className="space-y-2 rounded-card border border-rc-border bg-white p-5 shadow-card">
        <p className="text-sm text-rc-muted">{office.name}</p>
        <h1 className="text-xl font-bold text-rc-ink">{item.title}</h1>
        <p className="text-sm text-rc-muted">{item.details}</p>
        {extra.length > 0 && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 pt-1 text-sm">
            {extra.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-rc-muted">{k}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-rc-ink">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {HAS_DOCUMENT.has(type) && (
          <a href={`/licensee/${token}/open/item`} target="_blank" rel="noreferrer" className="inline-block pt-1 text-sm font-semibold text-rc-green-deep underline">
            Open the document
          </a>
        )}
      </section>
      <ItemSign token={token} tick={ITEM_TICK[type]} agencyName={office.name} />
      <LicenseeOpenedBeacon token={token} />
    </Shell>
  );
}

/** The details the licensee reviews for an item that has no document. Plain text, as typed. */
async function itemLines(
  service: ReturnType<typeof createServiceClient>,
  agencyId: string,
  type: ItemType,
  id: string,
): Promise<Array<[string, string]>> {
  if (type === "complaint") {
    const { data } = await service
      .from("complaints")
      .select("received_date, complainant, nature, notes, resolved_date, resolved_by_name")
      .eq("agency_id", agencyId)
      .eq("id", id)
      .maybeSingle();
    const c = (data ?? {}) as Record<string, string | null>;
    return [
      ["Received", c.received_date ?? ""],
      ["From", c.complainant ?? ""],
      ["What it was about", c.nature ?? ""],
      ["Notes", c.notes ?? ""],
      ["Resolved", [c.resolved_date, c.resolved_by_name ? `by ${c.resolved_by_name}` : null].filter(Boolean).join(" ")],
    ].filter(([, v]) => v) as Array<[string, string]>;
  }
  if (type === "gift") {
    const { data } = await service
      .from("gifts")
      .select("gift_date, description, counterparty, value, direction, notes")
      .eq("agency_id", agencyId)
      .eq("id", id)
      .maybeSingle();
    const g = (data ?? {}) as Record<string, string | number | null>;
    return [
      ["Date", String(g.gift_date ?? "")],
      ["Gift", String(g.description ?? "")],
      [g.direction === "given" ? "Given to" : "From", String(g.counterparty ?? "")],
      ["Value", g.value != null ? `About $${g.value}` : ""],
      ["Notes", String(g.notes ?? "")],
    ].filter(([, v]) => v) as Array<[string, string]>;
  }
  if (type === "training_plan") {
    const { data } = await service
      .from("training_plans")
      .select("cpd_year_start, consultation_date, identified_gaps, required_hours, required_units, requirement_note")
      .eq("agency_id", agencyId)
      .eq("id", id)
      .maybeSingle();
    const t = (data ?? {}) as Record<string, string | number | null>;
    return [
      ["CPD year from", String(t.cpd_year_start ?? "")],
      ["Consultation", String(t.consultation_date ?? "")],
      ["Gaps identified", String(t.identified_gaps ?? "")],
      ["Required", [t.required_hours ? `${t.required_hours} hours` : null, t.required_units ? `${t.required_units} units` : null].filter(Boolean).join(", ")],
      ["Note", String(t.requirement_note ?? "")],
    ].filter(([, v]) => v) as Array<[string, string]>;
  }
  if (type === "trust_audit") {
    const { data } = await service
      .from("trust_audits")
      .select("period_end, auditor_name, report_received_on, notes")
      .eq("agency_id", agencyId)
      .eq("id", id)
      .maybeSingle();
    const a = (data ?? {}) as Record<string, string | null>;
    return [
      ["Audit year to", a.period_end ?? ""],
      ["Auditor", a.auditor_name ?? ""],
      ["Report received", a.report_received_on ?? ""],
      ["Notes", a.notes ?? ""],
    ].filter(([, v]) => v) as Array<[string, string]>;
  }
  return [];
}
