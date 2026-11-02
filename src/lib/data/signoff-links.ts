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
//
// No new b4 link since 2 Nov 2026 (REVERSAL, 0104): an agent ticks the price
// statement card now. The old rows stay, and are still read as "b4" here so
// that nothing takes one for the final sign-off.

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
  /** When a person first opened it in a browser (0107). Null before 0107 is run. */
  openedAt: string | null;
  /** Each time someone copied it to send it themselves (0107, option 2), oldest first. */
  copies: Array<{ by: string; at: string }>;
  /** The licensee in charge it went to, by name where the office has one (for the nudge). */
  licenseeName: string;
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
  const COLUMNS =
    "id, agency_id, item_key, sent_to, created_at, expires_at, signed_at, signed_name, email_sent_at, email_attempts, email_error, price_statement, esp_low, esp_high";
  // opened_at arrives with 0107; until then the read without it still works.
  const read = (columns: string) =>
    supabase
      .from("property_signoff_requests")
      .select(columns)
      .eq("property_id", propertyId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
  let result: { data: unknown; error: unknown } = await read(`${COLUMNS}, opened_at`);
  if (result.error) result = await read(COLUMNS);
  const rows = (result.data ?? []) as Array<Record<string, string | number | null>>;

  // Who copied which link, and the licensee's name for the nudge.
  const ids = rows.map((r) => String(r.id));
  const agencyId = rows[0]?.agency_id ? String(rows[0].agency_id) : null;
  const [{ data: copyRows }, { data: agency }] = await Promise.all([
    ids.length > 0
      ? supabase.from("signoff_link_copies").select("request_id, copied_by_name, copied_at").in("request_id", ids).order("copied_at")
      : Promise.resolve({ data: [] as unknown[] }),
    agencyId
      ? supabase.from("agencies").select("licensee_name").eq("id", agencyId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const copiesOf = new Map<string, Array<{ by: string; at: string }>>();
  for (const c of (copyRows ?? []) as Array<{ request_id: string; copied_by_name: string; copied_at: string }>) {
    copiesOf.set(c.request_id, [...(copiesOf.get(c.request_id) ?? []), { by: c.copied_by_name, at: c.copied_at }]);
  }
  const licenseeName = ((agency as { licensee_name?: string | null } | null)?.licensee_name ?? "").trim();

  const links: SignoffLink[] = [];
  for (const row of rows) {
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
      openedAt: (row.opened_at as string | null | undefined) ?? null,
      copies: copiesOf.get(String(row.id)) ?? [],
      licenseeName: licenseeName || String(row.sent_to ?? ""),
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
