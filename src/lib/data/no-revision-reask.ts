import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reopens d3 where it was answered "no revision needed" and the advertised
 * price has since moved on the listing page.
 *
 * The answer was given honestly, on the information available at the time;
 * a price change on the website is new information. Reopened rather than
 * flagged — nothing has gone wrong, a question has simply been re-asked.
 *
 * Only touches an item still answered "no". An answered "yes, revised" is left
 * alone, since the revision it records may well be the response to this, and
 * so is one nobody has answered yet.
 *
 * Takes the caller's database connection (10 Oct 2026). It used to be a
 * server action that opened its own signed-in connection, which on the 7am
 * scan (no one signed in, run on the server's own access) was signed out: it
 * could not see d3, so it quietly did nothing, and the price move was used up
 * because the scan then recorded the new price as the last one seen. Kept out
 * of the "use server" files so a browser cannot call it.
 */
export async function reopenStaleNoRevision(
  supabase: SupabaseClient,
  propertyId: string,
  reason: string,
): Promise<void> {
  const { data: row } = await supabase
    .from("property_items")
    .select("id, status, data")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();

  const d3 = (row as { id?: string; status?: string; data?: { espRevised?: boolean } } | null) ?? null;
  if (!d3?.id || d3.status !== "done" || d3.data?.espRevised !== false) return;

  await supabase
    .from("property_items")
    .update({
      status: "open",
      completed_by: null,
      data: { ...d3.data, espRevised: undefined, reopenedReason: reason },
    })
    .eq("id", d3.id);
}
