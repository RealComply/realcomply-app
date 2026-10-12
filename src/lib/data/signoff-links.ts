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
// The token is NOT read here (Adam, 9 Oct 2026). Since 0058 nobody signed in
// can read it: the link goes only to the licensee, by email, so an agent
// cannot open it and sign as the licensee. lib/actions/signoff-links.ts reads
// it with the server's own access when it sends the email.
//
// TWO KINDS OF LINK SINCE 0066 (Adam, 12 Oct 2026). A link is either the final
// sign-off (sign_licensee) or, where the office's licensee in charge does not
// use RealComply, the price statement approval (b4). Same table, same token
// rules, different purpose. Every helper below takes the kind it wants and
// there is no default, so a b4 request can never be read as the final
// sign-off: a signed b4 is not the licensee's signature on the file, and a
// live b4 does not mean the file has gone to the licensee.

export type SignoffLinkItem = "sign_licensee" | "b4";

export type SignoffLink = {
  id: string;
  /** What the link is for (0066). Existing links read as the final sign-off. */
  itemKey: SignoffLinkItem;
  sentTo: string;
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
  signedName: string | null;
  /**
   * Delivery, which is a different fact from creation — see 0047.
   *
   * `emailSentAt` null with `emailAttempts` above zero means the link exists
   * and was never delivered. The panel must say that plainly rather than show
   * a created date and let the agent infer a send.
   */
  emailSentAt: string | null;
  emailAttempts: number;
  emailError: string | null;
  /** b4 only: the exact words the licensee is asked to approve, fixed when it was sent. */
  priceStatement: string | null;
  /** b4 only: the estimated selling price shown with it, fixed by the database when it was sent. */
  espLow: number | null;
  espHigh: number | null;
};

const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Every link issued for this property that has not been withdrawn, newest first. Both kinds. */
export async function signoffLinksFor(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<SignoffLink[]> {
  const { data } = await supabase
    .from("property_signoff_requests")
    .select(
      "id, item_key, sent_to, created_at, expires_at, signed_at, signed_name, email_sent_at, email_attempts, email_error, price_statement, esp_low, esp_high",
    )
    .eq("property_id", propertyId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const links: SignoffLink[] = [];
  for (const row of (data ?? []) as Array<Record<string, string | number | null>>) {
    // A kind this app does not know is left out rather than guessed at: read
    // as the final sign-off, it could close the file.
    const itemKey = row.item_key === "b4" ? "b4" : row.item_key === "sign_licensee" ? "sign_licensee" : null;
    if (!itemKey) continue;
    links.push({
      id: String(row.id),
      itemKey,
      sentTo: String(row.sent_to ?? ""),
      createdAt: String(row.created_at),
      expiresAt: String(row.expires_at),
      signedAt: (row.signed_at as string | null) ?? null,
      signedName: (row.signed_name as string | null) ?? null,
      emailSentAt: (row.email_sent_at as string | null) ?? null,
      emailAttempts: Number(row.email_attempts ?? 0),
      emailError: (row.email_error as string | null) ?? null,
      priceStatement: (row.price_statement as string | null) ?? null,
      espLow: numberOrNull(row.esp_low),
      espHigh: numberOrNull(row.esp_high),
    });
  }
  return links;
}

/** The links of one kind, newest first. */
export function linksFor(links: SignoffLink[], itemKey: SignoffLinkItem): SignoffLink[] {
  return links.filter((l) => l.itemKey === itemKey);
}

/** The one of this kind that can still be signed, if there is one. */
export function liveLink(links: SignoffLink[], itemKey: SignoffLinkItem, now: Date = new Date()): SignoffLink | null {
  return linksFor(links, itemKey).find((l) => l.signedAt === null && new Date(l.expiresAt) > now) ?? null;
}

/** The signature (or approval) given through a link of this kind, if there is one. */
export function signedLink(links: SignoffLink[], itemKey: SignoffLinkItem): SignoffLink | null {
  return linksFor(links, itemKey).find((l) => l.signedAt !== null) ?? null;
}
