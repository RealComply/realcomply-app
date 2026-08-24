import { createClient } from "@/lib/supabase/server";
import { STAGE_LABELS, type Property, type Profile } from "@/lib/types";

// Global search.
//
// WHY A ROUTE HANDLER rather than loading everything into the layout. The
// alternative — fetch every listing and every person in the dashboard layout
// and filter in the browser — is simpler and would work today, at seven
// listings. It also means every page in the app pays for a search nobody has
// opened yet. This way the cost lands when someone actually types.
//
// RLS does the scoping. There is no agency filter below and there must not be
// one: the policies already restrict both tables to the caller's agency, and a
// hand-written filter here would be a second, weaker copy of that rule that
// could silently disagree with it.

export const dynamic = "force-dynamic";

export type SearchHit = {
  kind: "listing" | "person";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

// PostgREST builds `or=(a.ilike.%x%,b.ilike.%x%)` from a STRING, so a comma,
// bracket or dot in the query is not data — it is syntax, and it changes the
// filter rather than failing. `%` and `_` are ilike wildcards, so a lone "%"
// would match every row in the table.
//
// Rather than escape each of those, this keeps only the characters an address
// or a name can contain. It is the conservative direction: the worst case is a
// search that finds nothing, not a search that returns somebody else's rows.
function sanitise(raw: string): string {
  return raw
    .slice(0, 60)
    .replace(/[^\p{L}\p{N}\s'\-/&.]/gu, " ")
    .replace(/[.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const term = sanitise(new URL(request.url).searchParams.get("q") ?? "");

  // Two characters is the floor. One letter matches most of the database and
  // is never what someone meant.
  if (term.length < 2) {
    return Response.json({ hits: [] satisfies SearchHit[] });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 200 with nothing, not 401. This is called from a palette in the chrome; a
  // session that expired mid-session should show "nothing found" and let the
  // next navigation redirect to login properly, rather than throwing a console
  // error behind an open dialog.
  if (!user) {
    return Response.json({ hits: [] satisfies SearchHit[] });
  }

  const [{ data: propertyRows }, { data: peopleRows }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, stage, test_mode")
      .ilike("address", `%${term}%`)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("profiles")
      .select("id, full_name, email, is_licensee_in_charge, is_assistant, is_agent")
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(4),
  ]);

  const listings: SearchHit[] = ((propertyRows ?? []) as Pick<
    Property,
    "id" | "address" | "stage" | "test_mode"
  >[]).map((p) => ({
    kind: "listing",
    id: p.id,
    title: p.address,
    // Test files are findable but labelled. Hiding them would be worse — Adam
    // would search for one he had just made and conclude search was broken.
    subtitle: p.test_mode ? `${STAGE_LABELS[p.stage]} · Test file` : STAGE_LABELS[p.stage],
    href: `/dashboard/${p.id}`,
  }));

  const people: SearchHit[] = ((peopleRows ?? []) as Pick<
    Profile,
    "id" | "full_name" | "email" | "is_licensee_in_charge" | "is_assistant" | "is_agent"
  >[]).map((s) => ({
    kind: "person",
    id: s.id,
    title: s.full_name ?? s.email,
    subtitle: s.is_licensee_in_charge
      ? "Licensee in charge"
      : s.is_assistant
        ? "Assistant"
        : s.is_agent
          ? "Agent"
          : "Team member",
    // The staff roster, not a per-person page — there isn't one, and sending
    // someone to a route that does not exist is a worse result than sending
    // them to the page that lists everybody.
    href: "/dashboard/team",
  }));

  return Response.json({ hits: [...listings, ...people] });
}
