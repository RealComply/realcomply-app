import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { STAGE_LABELS, type Property, type PropertyItem } from "@/lib/types";

// The finalised, read-only compliance record — what item f2 ("Generate
// finalised compliance file") produces. Production version is a branded
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
  const items = allItemsFor(p);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 print:px-0">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dashboard/${p.id}`} className="text-sm text-neutral-500 hover:underline">
          ← Back to file
        </Link>
        <button
          className="rounded-md bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white"
        >
          Use your browser&rsquo;s Print → Save as PDF
        </button>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-rc-ink">
        Real<span className="text-rc-green-deep">Comply</span> — Finalised compliance record
      </h1>
      <p className="mt-1 text-sm text-neutral-500">{p.address}</p>
      <p className="mt-1 text-xs text-neutral-400">
        Generated {new Date().toLocaleString("en-AU")} · diligence support — verify with your adviser; the
        licensee decides.
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
                  return (
                    <li key={item.key} className="text-sm">
                      <span className="font-medium text-rc-ink">{item.label}</span>{" "}
                      <span className="text-neutral-500">
                        — {current?.status ?? "open"}
                        {current?.event_date ? ` · ${current.event_date}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-10 text-xs text-neutral-400">
        Prepared for {profile.full_name ?? profile.email}. This record reflects diligence-support content
        maintained in RealComply and is not legal advice.
      </p>
    </main>
  );
}
