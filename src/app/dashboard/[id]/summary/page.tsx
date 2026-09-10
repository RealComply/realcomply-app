import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { STAGE_LABELS, type Property, type PropertyItem } from "@/lib/types";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import { formatAuDate } from "@/lib/format-date";



// The finalised, read-only compliance record — what item f2 ("Generate
// finalised compliance file") produces, and also the one-click "audit pack"
// a licensee hands to Fair Trading or points a regulator at. Per the
// product philosophy doc (§2, "diligence record, not a breach ledger"):
// this shows CURRENT state honestly — including any flag that's open right
// now — not a historical catalogue of past breaches. A flag that's since
// been resolved just reads "done," same as anything else; only what's
// actually open today gets called out. Production version is a branded
// PDF; this is a real, printable summary of the same data today (use the
// browser's print-to-PDF for now).
export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: property } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!property) notFound();
  const p = property as Property;

  const { data: rows } = await supabase.from("property_items").select("*").eq("property_id", id);
  const allItems = Object.fromEntries(((rows ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
  const items = allItemsFor(p, allItems, await ruleContextFor(supabase, p));

  // Signed off, or not. Same test as the PDF route and the PDF itself — see the
  // note in lib/pdf/compliance-record.ts for why an unsigned pack has to say so
  // on its own face rather than relying on somebody noticing a missing section.
  const signedName = (key: string) =>
    (allItems[key]?.data as { typedName?: string } | undefined)?.typedName ?? null;
  const missingSignatures = [
    signedName("sign_agent") ? null : "the agent",
    signedName("sign_licensee") ? null : "the licensee in charge",
  ].filter((s): s is string => s !== null);
  const isDraft = missingSignatures.length > 0;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 print:px-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dashboard/${p.id}`} className="text-sm font-medium text-rc-muted transition hover:text-rc-green-deep">
          ← Back to file
        </Link>
        {/* A link, not a button, and it points at a route that returns the
            file with Content-Disposition: attachment. One click, one file in
            Downloads, no dialog and no decision.

            It used to read "Use your browser's Print → Save as PDF" and had no
            click handler at all: a label telling the agent to go and find a
            browser menu. Adam, 23 Aug 2026: plenty of agents will not know how,
            and this is the document Fair Trading asks for. */}
        <a
          href={`/dashboard/${p.id}/summary/pdf`}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600"
        >
          Save as PDF
        </a>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-rc-ink">
        Real<span className="text-rc-green-deep">Comply</span> —{" "}
        {isDraft ? "Compliance record (draft)" : "Finalised compliance record"}
      </h1>
      <p className="mt-1 text-sm text-rc-muted">{p.address}</p>

      {/* Said on screen as well as in the PDF, because this page prints — the
          comment at the top of this file says as much — and a printed page with
          no draft notice is the exact document this change exists to prevent.
          Adam, 9 Sep 2026: "I feel like we're missing the step where the audit
          pack actually gets signed off." */}
      {isDraft && (
        <div className="mt-3 rounded-card border border-rc-amber/40 bg-rc-amber/5 px-4 py-3">
          <p className="text-sm font-bold text-rc-amber-deep">This is a draft, not the finalised record</p>
          <p className="mt-1 text-sm leading-relaxed text-rc-muted">
            Still to sign: {missingSignatures.join(" and ")}. Until then the file isn&rsquo;t closed out, and
            this copy shouldn&rsquo;t be handed over as the completed compliance record.
          </p>
        </div>
      )}
      <p className="mt-1 text-xs text-rc-faint">
        Generated {new Date().toLocaleString("en-AU")} · {RULESET_VERSION} · diligence support — verify with your
        adviser; the licensee decides.
      </p>

      <div className="mt-8 space-y-6">
        {([0, 1, 2, 3, 4, 5] as const).map((stage) => {
          const stageItems = items.filter((i) => i.stage === stage);
          if (stageItems.length === 0) return null;
          return (
            <section key={stage}>
              <h2 className="border-b border-rc-border pb-1 text-sm font-semibold text-rc-ink">
                {STAGE_LABELS[stage]}
              </h2>
              <ul className="mt-2 space-y-2">
                {stageItems.map((item) => {
                  const current = allItems[item.key];
                  const flaggedNote = current?.status === "flagged" ? (current.data as { note?: string })?.note : null;
                  return (
                    <li key={item.key} className="text-sm">
                      <span className="font-medium text-rc-ink">{item.label}</span>{" "}
                      <span className={current?.status === "flagged" ? "font-medium text-rc-amber-deep" : "text-rc-muted"}>
                        — {current?.status ?? "open"}
                        {current?.event_date ? ` · ${formatAuDate(current.event_date)}` : ""}
                      </span>
                      {item.legalBasis && <span className="ml-1 text-xs text-rc-faint">({item.legalBasis})</span>}
                      {flaggedNote && <p className="mt-0.5 text-xs text-rc-amber-deep">Open flag: {flaggedNote}</p>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-xs text-rc-faint">
        Prepared for {profile.full_name ?? profile.email}. This record reflects diligence-support content
        maintained in RealComply and is not legal advice.
      </p>
    </main>
  );
}
