import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOfficePage } from "@/lib/data/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { officeFor } from "@/lib/licensee-signoff/server";
import { dayLabel, draftItems, draftMonth, packItemsOf, packsFor, type PackItem } from "@/lib/licensee-signoff/pack";
import {
  GROUP_HEADINGS,
  NOTHING_WAITING,
  grouped,
  monthName,
  packHeading,
  preparedLine,
  type ItemType,
} from "@/lib/licensee-signoff/model";
import { openedLine, sentLine, unopenedNudgeDue } from "@/lib/links/delivery";
import { PackReview, type ReviewItem } from "@/components/licensee-signoff/PackReview";
import { PackSigned } from "@/components/licensee-signoff/PackSigned";
import { PackLinkStatus } from "@/components/licensee-signoff/PackLinkStatus";
import { PrepareItemRow, type PrepareItem } from "@/components/licensee-signoff/PrepareItemRow";
import { SendPack } from "@/components/licensee-signoff/SendPack";

// Licensee sign-off (Adam, 3 Nov 2026; the approved mockup; 0109). For the
// licensee in charge and the office manager. It builds itself from
// everything waiting for the licensee's signature: the office manager
// prepares the month's pack and sends it; the licensee reviews and signs it
// here (or through the emailed link); then the signed result. With no
// office manager, the licensee prepares it and signs it themselves. It works
// whichever way the office has set "How your licensee signs off".

export const dynamic = "force-dynamic";

const OPEN_LABEL: Record<ItemType, string> = {
  sales_file: "Open file",
  trust_reconciliation: "Open",
  trust_audit: "Open",
  sg_manual: "Open",
  training_plan: "Open",
  complaint: "Open",
  gift: "Open",
};

export default async function LicenseeSignoffPage() {
  const { profile, access } = await requireOfficePage();
  if (access.isAgentPlan) notFound();
  const supabase = await createClient();
  const office = await officeFor(createServiceClient(), profile.agency_id);
  if (!office) notFound();
  const packs = await packsFor(supabase, profile.agency_id);
  const today = dayLabel(new Date().toISOString());
  const omName = office.officeManagers[0]?.name ?? null;

  // A pack signed in the last month: its result at the top.
  const recent =
    packs.lastSigned && new Date().getTime() - Date.parse(packs.lastSigned.signed_at ?? "") < 31 * 86400_000 ? packs.lastSigned : null;
  const recentItems = recent ? await packItemsOf(supabase, profile.agency_id, recent.id) : [];
  const signedBlock = recent ? (
    <PackSigned
      pack={recent}
      items={recentItems}
      licenseeName={office.licensee.name}
      officeManagerName={omName}
      pdfHref={recent.signed_file_path ? `/dashboard/licensee-signoff/pdf?pack=${recent.id}` : null}
    />
  ) : null;

  // ── A pack sent and waiting for the licensee ──
  if (packs.open) {
    const items = await packItemsOf(supabase, profile.agency_id, packs.open.id);
    const hrefs = await appHrefs(supabase, profile.agency_id, items);
    const sent = `Sent by ${packs.open.sent_by_name ?? "the office"} on ${dayLabel(packs.open.sent_at ?? "")}.`;
    if (access.officeLicensee) {
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
          openHref: hrefs.get(i.id) ?? null,
          openLabel: i.type === "sales_file" ? "Audit pack" : "Open",
        })),
      );
      return (
        <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-10">
          {signedBlock}
          <PackReview
            via="app"
            packId={packs.open.id}
            monthLabel={monthName(packs.open.month)}
            sentLine={sent}
            pdfHref={`/dashboard/licensee-signoff/pdf?pack=${packs.open.id}`}
            items={reviewItems}
            licenseeName={office.licensee.name}
            todayLabel={today}
            agencyName={office.name}
          />
        </main>
      );
    }
    // The office manager: where the pack is up to, and what's in it.
    const { data: links } = await supabase
      .from("licensee_links")
      .select("id, created_at, email_sent_at, email_attempts, opened_at, used_at, revoked_at")
      .eq("agency_id", profile.agency_id)
      .eq("pack_id", packs.open.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const link = ((links ?? []) as Array<Record<string, string | number | null>>)[0] ?? null;
    const delivery = link
      ? {
          emailSentAt: (link.email_sent_at as string | null) ?? null,
          createdAt: String(link.created_at),
          openedAt: (link.opened_at as string | null) ?? null,
          doneAt: (link.used_at as string | null) ?? null,
        }
      : null;
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-10">
        {signedBlock}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{packHeading(packs.open.month)}</h1>
          <p className="mt-1 text-sm text-rc-muted">
            {sent} Waiting for {office.licensee.name} to sign. Anything that comes in now goes into{" "}
            {monthName(nextOf(packs.open.month))}&apos;s pack.
          </p>
        </div>
        <PackLinkStatus
          linkId={link && !link.used_at && !link.revoked_at ? String(link.id) : null}
          licenseeName={office.licensee.name}
          sentLine={delivery ? sentLine(delivery) : null}
          openedLine={delivery ? openedLine(delivery) : null}
          nudge={
            delivery && unopenedNudgeDue(delivery)
              ? `${office.licensee.name} hasn't opened the pack yet. Copy the link and send it yourself, or ask them to check their quarantine.`
              : null
          }
          emailFailed={Boolean(link && !link.email_sent_at && Number(link.email_attempts) > 0)}
        />
        <ItemsCard items={items.map((i) => toPrepare(i, hrefs))} canNote={false} />
      </main>
    );
  }

  // ── Preparing the month's pack ──
  const month = draftMonth(packs.sentMonths);
  const items = await draftItems(supabase, profile.agency_id);
  const isLicensee = office.licensee.profileId === profile.id;
  const prepare: PrepareItem[] = items.map((i) => ({
    type: i.type,
    id: i.id,
    title: i.title,
    details: i.details,
    flagged: i.flagged,
    flagText: i.flagText,
    note: i.note,
    noteBy: i.noteBy,
    heldBackNote: i.heldBackNote,
    href: i.type === "sales_file" ? i.href : i.href,
    openLabel: OPEN_LABEL[i.type],
  }));
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-10">
      {signedBlock}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-rc-ink">{packHeading(month)}</h1>
          <p className="mt-1 text-sm text-rc-muted">
            {preparedLine(month, office.licensee.name, {
              name: (profile.full_name ?? "").trim() || profile.email || "you",
              officeManager: access.isOfficeManager && !isLicensee,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Link
            href="/dashboard/licensee-signoff/pdf?draft=1"
            prefetch={false}
            className="inline-flex min-h-10 items-center rounded-lg border border-rc-border bg-white px-4 text-sm font-semibold text-rc-ink"
          >
            Download pack (PDF)
          </Link>
          <SendPack
            month={month}
            label={isLicensee ? "Review and sign" : "Send to licensee"}
            disabled={items.length === 0 || (!isLicensee && !office.licensee.email)}
          />
        </div>
      </div>
      {!isLicensee && !office.licensee.email && (
        <p role="alert" className="text-sm text-rc-amber-deep">
          There&apos;s no email for your licensee in charge. Email admin@realcomply.com.au and we&apos;ll add it.
        </p>
      )}
      <ItemsCard items={prepare} canNote />
    </main>
  );
}

function ItemsCard({ items, canNote }: { items: PrepareItem[]; canNote: boolean }) {
  const groups = grouped(items.map((i, n) => ({ ...i, group: groupOf(i.type), at: String(n).padStart(6, "0") })));
  return (
    <section className="space-y-4 rounded-card border border-rc-border bg-white p-4 shadow-card sm:p-5">
      {groups.map((g) => (
        <div key={g.group}>
          <h2 className="flex justify-between text-xs font-bold uppercase tracking-wide text-rc-muted">
            <span>{GROUP_HEADINGS[g.group]}</span>
            <span>{g.items.length}</span>
          </h2>
          {g.items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-rc-muted">{NOTHING_WAITING}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {g.items.map((i) => (
                <PrepareItemRow key={`${i.type}:${i.id}`} item={i} canNote={canNote} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function groupOf(type: string) {
  return (
    { sales_file: "sales", trust_reconciliation: "trust", trust_audit: "trust" } as Record<string, "sales" | "trust">
  )[type] ?? ("office" as const);
}

function nextOf(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

function toPrepare(i: PackItem, hrefs: Map<string, string>): PrepareItem {
  return {
    type: i.type,
    id: i.id,
    title: i.title,
    details: i.details,
    flagged: i.flagged,
    flagText: i.flagText,
    note: i.note,
    noteBy: i.noteBy,
    heldBackNote: null,
    href: hrefs.get(i.id) ?? "/dashboard/licensee-signoff",
    openLabel: OPEN_LABEL[i.type],
  };
}

/** Where each pack item opens in the app: a sales file's read-only record and audit pack, or its register. */
async function appHrefs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agencyId: string,
  items: PackItem[],
): Promise<Map<string, string>> {
  const requestIds = items.filter((i) => i.type === "sales_file").map((i) => i.itemId);
  const { data } =
    requestIds.length > 0
      ? await supabase.from("property_signoff_requests").select("id, property_id").eq("agency_id", agencyId).in("id", requestIds)
      : { data: [] as Array<{ id: string; property_id: string }> };
  const propertyOf = new Map(((data ?? []) as Array<{ id: string; property_id: string }>).map((r) => [r.id, r.property_id]));
  const place: Record<ItemType, string> = {
    sales_file: "",
    trust_reconciliation: "/dashboard/trust",
    trust_audit: "/dashboard/trust",
    sg_manual: "/dashboard/sg-manual",
    training_plan: "/dashboard/training-plans",
    complaint: "/dashboard/registers?tab=complaints",
    gift: "/dashboard/registers?tab=gifts",
  };
  return new Map(
    items.map((i) => [
      i.id,
      i.type === "sales_file"
        ? propertyOf.get(i.itemId)
          ? `/dashboard/${propertyOf.get(i.itemId)}/summary`
          : "/dashboard"
        : place[i.type],
    ]),
  );
}
