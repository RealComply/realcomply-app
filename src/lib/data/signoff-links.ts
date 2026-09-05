import type { SupabaseClient } from "@supabase/supabase-js";

// The sign-off links issued for a property, read on the server and handed to
// the item card as a prop.
//
// WHY THIS IS A DATA FUNCTION AND NOT A CLIENT FETCH. The panel used to hold
// the link in component state, which meant it existed until the page was
// reloaded and then never again — the agent who sent it on Tuesday had nothing
// to re-send on Thursday. The obvious repair was to have the panel fetch its
// own state on mount, and the obvious repair was wrong: it puts a loading flash
// on a card that renders fine on the server, and it makes the state of a legal
// request depend on a round trip that may not come back.
//
// The token is readable by agency members under the RLS policy in 0014. There
// was never a reason to treat it as write-only.

export type SignoffLink = {
  id: string;
  token: string;
  sentTo: string;
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
  signedName: string | null;
};

/** Every link issued for this property that has not been withdrawn, newest first. */
export async function signoffLinksFor(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<SignoffLink[]> {
  const { data } = await supabase
    .from("property_signoff_requests")
    .select("id, token, sent_to, created_at, expires_at, signed_at, signed_name")
    .eq("property_id", propertyId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return ((data ?? []) as Array<Record<string, string | null>>).map((row) => ({
    id: String(row.id),
    token: String(row.token),
    sentTo: String(row.sent_to ?? ""),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    signedAt: row.signed_at ?? null,
    signedName: row.signed_name ?? null,
  }));
}

/** The one that can still be signed, if there is one. */
export function liveLink(links: SignoffLink[]): SignoffLink | null {
  const now = new Date();
  return links.find((l) => l.signedAt === null && new Date(l.expiresAt) > now) ?? null;
}

/** The signature, if it has been given. */
export function signedLink(links: SignoffLink[]): SignoffLink | null {
  return links.find((l) => l.signedAt !== null) ?? null;
}
