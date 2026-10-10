import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/data/current-profile";
import { loadPmCards, pmAgencySettings, pmPeople, type PmPropertyRow } from "@/lib/data/pm";
import { PM_GROUPS, isPmGroup, type PmGroup } from "@/lib/rules/nsw-pm";
import { pmCardSummary } from "@/lib/rules/pm-engine";
import { PmCardOval, pmCardSpoken } from "@/components/pm/PmOval";
import { AddPmPropertyForm } from "@/components/pm/AddPmPropertyForm";
import { RecordsSystemSetting } from "@/components/pm/RecordsSystemSetting";

// The PM dashboard (brief A3): the groups down the side with a count beside
// each, property cards grouped under them, and "Add a property" on top.
//
// Built to stay usable at 150 or more properties per property manager:
//   - "All properties" shows the first few in each group, with a link to the
//     rest, rather than every card at once.
//   - One group, or a search by address, is paginated on the server.
//   - Each page costs the same handful of queries however many cards it shows.

const PER_GROUP_PREVIEW = 6;
const PAGE_SIZE = 24;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function href(params: { group?: string | null; q?: string | null; page?: number }) {
  const sp = new URLSearchParams();
  if (params.group) sp.set("group", params.group);
  if (params.q) sp.set("q", params.q);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const s = sp.toString();
  return `/dashboard/pm${s ? `?${s}` : ""}`;
}

export default async function PmDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; q?: string; page?: string }>;
}) {
  const { profile, access } = await requireAccess();
  const supabase = await createClient();
  const settings = await pmAgencySettings(supabase, profile.agency_id);
  if (!settings.enabled) notFound();

  const sp = await searchParams;
  const group: PmGroup | null = isPmGroup(sp.group) ? sp.group : null;
  const q = (sp.q ?? "").trim().slice(0, 120);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const countFor = (g: PmGroup | null) => {
    let query = supabase.from("pm_properties").select("id", { count: "exact", head: true });
    if (g) query = query.eq("grp", g);
    return query;
  };

  const [agencyRow, people, totalAll, ...groupCounts] = await Promise.all([
    supabase.from("agencies").select("name").eq("id", profile.agency_id).maybeSingle(),
    pmPeople(supabase),
    countFor(null),
    ...PM_GROUPS.map((g) => countFor(g.key)),
  ]);
  const counts = new Map<PmGroup, number>(PM_GROUPS.map((g, i) => [g.key, groupCounts[i].count ?? 0]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  // What to show: a flat, paginated list for one group or a search, or a
  // short preview of every group.
  type Section = { group: PmGroup | null; title: string; rows: PmPropertyRow[]; total: number };
  const sections: Section[] = [];
  let pagedTotal = 0;

  if (group || q) {
    let query = supabase.from("pm_properties").select("*", { count: "exact" }).order("address");
    if (group) query = query.eq("grp", group);
    if (q) query = query.ilike("address", `%${escapeLike(q)}%`);
    const from = (page - 1) * PAGE_SIZE;
    const { data, count } = await query.range(from, from + PAGE_SIZE - 1);
    pagedTotal = count ?? 0;
    const title = q
      ? `Results for “${q}”${group ? ` in ${PM_GROUPS.find((g) => g.key === group)!.label}` : ""}`
      : PM_GROUPS.find((g) => g.key === group)!.label;
    sections.push({ group, title, rows: (data ?? []) as PmPropertyRow[], total: pagedTotal });
  } else {
    const previews = await Promise.all(
      PM_GROUPS.filter((g) => (counts.get(g.key) ?? 0) > 0).map(async (g) => {
        const { data } = await supabase
          .from("pm_properties")
          .select("*")
          .eq("grp", g.key)
          .order("address")
          .range(0, PER_GROUP_PREVIEW - 1);
        return { group: g.key, title: g.label, rows: (data ?? []) as PmPropertyRow[], total: counts.get(g.key) ?? 0 };
      }),
    );
    sections.push(...previews);
  }

  const inputs = await loadPmCards(supabase, sections.flatMap((s) => s.rows));
  const pages = Math.max(1, Math.ceil(pagedTotal / PAGE_SIZE));
  // Who the viewer may file a property for (0058, can_see_agent): the licensee
  // anyone, an assistant themself and the agents they assist, an agent
  // themself. The picker offered an agent their assistant, which the database
  // would then refuse (preview check, 9 Oct 2026).
  let mayFileFor: Set<string> | null = null;
  if (!access.actsAsLicensee) {
    mayFileFor = new Set([profile.id]);
    if (profile.is_assistant) {
      const { data: links } = await supabase.from("assistant_agents").select("agent_id").eq("assistant_id", profile.id);
      for (const l of (links ?? []) as { agent_id: string }[]) mayFileFor.add(l.agent_id);
    }
  }
  const activePeople = people.filter((p) => !p.archived && (!mayFileFor || mayFileFor.has(p.id)));
  // An assistant files for the agents they assist, so the picker starts on an
  // agent, not on the assistant (check, 10 Oct 2026). Left on themself, the
  // property was the assistant's, and the agent it was for never saw it (0058).
  const defaultManagerId =
    profile.is_assistant && mayFileFor
      ? (activePeople.find((p) => p.id !== profile.id)?.id ?? profile.id)
      : profile.id;

  const navItems: { key: PmGroup | null; label: string; count: number }[] = [
    { key: null, label: "All properties", count: totalAll.count ?? 0 },
    ...PM_GROUPS.map((g) => ({ key: g.key, label: g.label, count: counts.get(g.key) ?? 0 })),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight text-rc-ink">Property management</h1>
      <RecordsSystemSetting
        agencyName={agencyRow.data?.name ?? "Your agency"}
        current={settings.recordsSystem}
        canChange={access.actsAsLicensee}
      />

      <div className="mt-5">
        <AddPmPropertyForm people={activePeople} defaultManagerId={defaultManagerId} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-[190px_minmax(0,1fr)]">
        {/* The groups. A column on a computer, a row of pills on a phone. */}
        <nav aria-label="Groups" className="flex flex-wrap content-start gap-1.5 md:flex-col md:flex-nowrap">
          {navItems.map((n) => {
            const on = (n.key ?? null) === group;
            return (
              <Link
                key={n.key ?? "all"}
                href={href({ group: n.key, q })}
                aria-current={on ? "page" : undefined}
                className={`flex items-center justify-between gap-2.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold transition ${
                  on ? "bg-rc-green-deep text-white" : "text-rc-ink hover:bg-white"
                }`}
              >
                <span>{n.label}</span>
                <span className={`font-medium tabular-nums ${on ? "text-white/80" : "text-rc-muted"}`}>{n.count}</span>
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          <form action="/dashboard/pm" className="relative mb-5 max-w-md">
            {group && <input type="hidden" name="group" value={group} />}
            <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-rc-faint" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search by address"
              aria-label="Search by address"
              className="w-full rounded-full border border-rc-border bg-white py-2 pl-9 pr-3 text-sm focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </form>

          {sections.length === 0 || sections.every((s) => s.rows.length === 0) ? (
            <div className="rounded-card border border-dashed border-rc-border bg-white px-6 py-14 text-center text-sm text-rc-muted">
              {q ? "No properties match that address." : group ? "No properties in this group." : "No properties yet. Add your first one above."}
            </div>
          ) : (
            sections.map((s) => (
              <section key={s.group ?? "search"} className="mb-6">
                <h2 className="mb-2.5 text-[12.5px] font-bold uppercase tracking-[0.08em] text-rc-muted">
                  {s.title} ({s.total})
                </h2>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                  {s.rows.map((p) => {
                    const input = inputs.get(p.id)!;
                    const summary = pmCardSummary(input);
                    return (
                      <li key={p.id} className="min-w-0">
                        <Link
                          href={`/dashboard/pm/${p.id}`}
                          aria-label={`${p.address}, ${nameOf.get(p.manager_id) ?? ""}. ${pmCardSpoken(summary)}`}
                          className="block rounded-xl border border-rc-border bg-white px-4 py-3.5 shadow-card transition hover:border-rc-green-deep"
                        >
                          <p className="truncate text-[14.5px] font-bold text-rc-ink">{p.address}</p>
                          <p className="mb-2.5 mt-px truncate text-[12.5px] text-rc-muted">{nameOf.get(p.manager_id) ?? "No property manager"}</p>
                          <PmCardOval summary={summary} />
                          {summary.kind === "count" && (
                            <p className="mt-1.5 truncate text-[12px] text-rc-muted">{summary.stageTitle}</p>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {!group && !q && s.group && s.total > s.rows.length && (
                  <Link
                    href={href({ group: s.group })}
                    className="mt-2.5 inline-block text-[13px] font-semibold text-rc-green-deep hover:underline"
                  >
                    See all {s.total} in {s.title}
                  </Link>
                )}
              </section>
            ))
          )}

          {(group || q) && pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-[13px] text-rc-muted">
              <span>
                {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, pagedTotal)} of {pagedTotal}
              </span>
              <span className="flex gap-2">
                {page > 1 && (
                  <Link href={href({ group, q, page: page - 1 })} className="rounded-full border border-rc-border bg-white px-3 py-1 font-semibold text-rc-ink hover:border-rc-green-deep">
                    Previous
                  </Link>
                )}
                {page < pages && (
                  <Link href={href({ group, q, page: page + 1 })} className="rounded-full border border-rc-border bg-white px-3 py-1 font-semibold text-rc-ink hover:border-rc-green-deep">
                    Next
                  </Link>
                )}
              </span>
            </nav>
          )}
        </div>
      </div>
    </main>
  );
}
