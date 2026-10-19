import type { SupabaseClient } from "@supabase/supabase-js";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { buildComplianceRecordPdf, complianceRecordFilename, type Attachment } from "@/lib/pdf/compliance-record";
import { comparablesFor } from "@/lib/data/comparables";
import { marketListingsFor } from "@/lib/data/market-listings";
import { withEffectiveEspStatus } from "@/lib/rules/esp-reasoning-gate";
import { linkRequestNeedingTime, signatureOnCard } from "@/lib/rules/listing-signature";
import { priceApproval } from "@/lib/rules/price-statement";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { EMPTY_FILE_MESSAGE, downloadedFileProblem } from "@/lib/storage/file-check";
import type { Property, PropertyItem } from "@/lib/types";
import { formalAgencyName, namesAsAt, type AgencyNames, type NameChange } from "@/lib/agency-names";

// The audit pack for one listing: the finalised compliance record as a PDF.
//
// Moved out of app/dashboard/[id]/summary/pdf/route.ts on 8 Oct 2026 so the
// records page (an agency whose subscription has ended) can build the same
// pack, unchanged, for "Download all records" and for each listing on its own.
// The route passes the signed-in user's client, so RLS scopes it as before.
// The records page passes the service client, after checking the caller is
// the licensee in charge or account holder of that agency, and the agency id
// below keeps every query inside that one agency.
//
// Null when the listing does not exist (or is not visible to the client).
export async function buildAuditPack(
  supabase: SupabaseClient,
  propertyId: string,
  agencyId: string,
  preparedFor: string,
): Promise<{ pdf: Uint8Array; filename: string } | null> {
  const id = propertyId;
  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .eq("agency_id", agencyId)
    .maybeSingle();
  if (!property) return null;
  const p = property as Property;

  // The agency leads the document (Adam, 23 Aug 2026): their logo where they
  // have one, the office name, then the agent whose file this is.
  //
  // Keyed off whether a logo EXISTS rather than off a subscription tier. The
  // tiers do not exist yet and this does not need them: an office that uploads
  // one gets it, an individual agent who has none gets the text masthead, which
  // is the correct output for them rather than a degraded one.
  const [{ data: agencyRow }, { data: agentRow }] = await Promise.all([
    supabase.from("agencies").select("*").eq("id", agencyId).maybeSingle(),
    p.created_by
      ? supabase.from("profiles").select("full_name, email").eq("id", p.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const agency = agencyRow as { name?: string; logo_path?: string | null; licensed_entity_name?: string | null } | null;
  const agent = agentRow as { full_name?: string | null; email?: string } | null;
  const currentNames: AgencyNames = {
    tradingName: agency?.name ?? "Your agency",
    licensedEntityName: agency?.licensed_entity_name ?? null,
  };
  const agentName = agent?.full_name ?? agent?.email ?? null;

  // Fetched here rather than inside the PDF builder, which has no database of
  // its own on purpose — it takes data and returns bytes, so it stays testable
  // and cannot surprise anyone with a network call.
  //
  // A logo that fails to download must never cost the agent their document: the
  // record is what they were asked for, the branding is not. So this falls back
  // to no logo rather than throwing.
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (agency?.logo_path) {
    try {
      const { data: blob } = await supabase.storage.from(EVIDENCE_BUCKET).download(agency.logo_path);
      if (blob) {
        const type = /\.jpe?g$/i.test(agency.logo_path) ? "jpg" : "png";
        logo = { bytes: new Uint8Array(await blob.arrayBuffer()), type };
      }
    } catch {
      logo = null;
    }
  }

  const { data: rows } = await supabase.from("property_items").select("*").eq("property_id", id).eq("agency_id", agencyId);
  const listings = await marketListingsFor(supabase, id);
  // The ESP reasoning card prints by its completion rule, the same as the page
  // (lib/rules/esp-reasoning-gate.ts).
  const byKey = withEffectiveEspStatus(
    Object.fromEntries(((rows ?? []) as PropertyItem[]).map((i) => [i.item_key, i])),
    { onMarketCount: listings.filter((l) => l.asAt === null).length },
  );
  const items = allItemsFor(p, byKey, await ruleContextFor(supabase, p));

  // ── The substance, not just the ticks (Adam, 24 Aug 2026) ───────────────
  //
  // He asked for the comparable sales, the ESP reasoning, the ESP revision
  // notice, and the date the contract was received. Three of those are content
  // this pack now reproduces; the fourth is a date, now captured on the
  // contract card.
  const noteOf = (key: string) => {
    const n = (byKey[key]?.data as { note?: string } | undefined)?.note?.trim();
    return n && n.length > 0 ? n : null;
  };

  // Either way it was given: in the app, or through the emailed sign-off link,
  // whose time is on the request (lib/rules/listing-signature.ts). Only a
  // final sign-off request: a price statement request (b4, 0066) is never a
  // signature on the file. And only on a card that is done (12 Oct 2026): a
  // name written on an open card is not a signature.
  const linkSignedAt = async (key: string): Promise<string | null> => {
    const requestId = linkRequestNeedingTime(byKey[key]?.data);
    if (!requestId) return null;
    const { data: request } = await supabase
      .from("property_signoff_requests")
      .select("signed_at")
      .eq("id", requestId)
      .eq("agency_id", agencyId)
      .eq("item_key", "sign_licensee")
      .maybeSingle();
    return (request as { signed_at?: string | null } | null)?.signed_at ?? null;
  };
  const signatureOf = async (key: string) =>
    byKey[key]?.status === "done" ? signatureOnCard(byKey[key], await linkSignedAt(key)) : null;

  // Whether this pack is a draft, decided here as well as inside the PDF —
  // because the FILENAME has to know too, and the filename is set out here.
  //
  // Adam, 9 Sep 2026, on being able to download the pack at any point: "I feel
  // like we're missing the step where the audit pack actually gets signed off."
  // The step existed; what was missing is that an unsigned pack looked exactly
  // like a signed one, right down to a heading reading "Finalised compliance
  // record". Both halves of that are now fixed, and the filename matters most
  // of the two — a file attached to an email is judged by its name long before
  // anybody opens page one.
  const agentSignature = await signatureOf("sign_agent");
  const licenseeSignature = await signatureOf("sign_licensee");
  const isDraft = !agentSignature || !licenseeSignature;

  // The office's names on the cover (brief, 14 Oct 2026): "[licensed entity
  // name] trading as [trading name]", or the trading name alone. A finished
  // file keeps the names it was finished under: it is rebuilt on every
  // download, so a later change of name must not reach back into it. The
  // history of changes (agency_name_changes, 0070) says what they were.
  const names = isDraft
    ? currentNames
    : await namesWhenFinished(supabase, agencyId, currentNames, [agentSignature.signedAt, licenseeSignature.signedAt]);
  const agencyName = names.tradingName;

  // Deliberately NOT the contract for sale. Adam named the DATE it was
  // received, not the document, and appending a contract would routinely add a
  // hundred pages to a record that has to stay emailable.
  const ATTACH: Array<{ key: string; title: string }> = [
    { key: "a4", title: "Comparable sales report" },
    { key: "d3", title: "Notice of revised estimated selling price" },
  ];

  const attachments: Attachment[] = [];
  for (const { key, title } of ATTACH) {
    const row = byKey[key];
    if (!row?.evidence_path) continue;
    const fileName =
      (row.data as { evidenceFileName?: string } | undefined)?.evidenceFileName ??
      row.evidence_path.split("/").pop() ??
      "document";
    const lower = fileName.toLowerCase();
    const kind: Attachment["kind"] = lower.endsWith(".pdf")
      ? "pdf"
      : lower.endsWith(".png")
        ? "png"
        : /\.jpe?g$/.test(lower)
          ? "jpg"
          : "other";

    if (kind === "other") {
      // Listed, not silently dropped. A document missing from a pack with no
      // explanation is worse than one the pack tells you to ask for.
      attachments.push({ title, fileName, bytes: null, kind, omittedBecause: "not a PDF or image" });
      continue;
    }

    try {
      const { data: blob } = await supabase.storage.from(EVIDENCE_BUCKET).download(row.evidence_path);
      // An empty or damaged file (19 Oct 2026) is named as one, not passed off
      // as "could not be opened, held on file": nothing usable is held.
      const unreadable = blob ? await downloadedFileProblem(blob, fileName) : null;
      attachments.push(
        !blob
          ? { title, fileName, bytes: null, kind, omittedBecause: "could not be read" }
          : unreadable
            ? {
                title,
                fileName,
                bytes: null,
                kind,
                omittedBecause: unreadable === EMPTY_FILE_MESSAGE ? "came through empty" : "didn't come through whole",
                needsUploadingAgain: true,
              }
            : { title, fileName, bytes: new Uint8Array(await blob.arrayBuffer()), kind },
      );
    } catch {
      attachments.push({ title, fileName, bytes: null, kind, omittedBecause: "could not be read" });
    }
  }

  const generatedAt = new Date();
  const pdf = await buildComplianceRecordPdf({
    property: p,
    agencyName,
    agencyLine: formalAgencyName(names),
    agentName,
    logo,
    items,
    byKey,
    espReasoning: noteOf("a4c"),
    // Where the agent said the reasoning lives, if they said it lives outside
    // RealComply. Without this the section simply vanishes from the record,
    // which reads as "no reasoning was recorded" — the worst thing a file can
    // imply on the item s74 is most likely to ask about.
    espReasoningElsewhere:
      (byKey["a4c"]?.data as { loggedElsewhere?: boolean; loggedElsewhereWhere?: string | null } | undefined)
        ?.loggedElsewhere === true
        ? ((byKey["a4c"]?.data as { loggedElsewhereWhere?: string | null } | undefined)
            ?.loggedElsewhereWhere ?? null)
        : null,
    // The sales the agent weighed. Part of the methodology record, not a
    // nicety — see the field note on ComplianceRecordInput.
    comparables: (await comparablesFor(supabase, id)).map((c) => ({
      address: c.address,
      salePrice: c.salePrice,
      saleDate: c.saleDate,
      weighting: c.weighting,
      agentNote: c.agentNote,
    })),
    // The competition, as at the agency agreement date (29 Sep 2026).
    marketListings: listings.map((l) => ({
      address: l.address,
      askingPrice: l.askingPrice,
      saleMethod: l.saleMethod,
      listedDate: l.listedDate,
      weighting: l.weighting,
      agentNote: l.agentNote,
    })),
    noneOnMarket: Boolean((byKey["a4c"]?.data as { noneOnMarket?: boolean } | undefined)?.noneOnMarket),
    agreementDate: byKey["a3"]?.event_date ?? null,
    // What the licensee approved before the listing was advertised, and how:
    // in the app, or through the emailed link (b4, 0066).
    priceApproval: priceApproval(byKey["b4"]),
    signatures: { agent: agentSignature, licensee: licenseeSignature },
    attachments,
    rulesetVersion: RULESET_VERSION,
    preparedFor,
    generatedAt,
  });

  const filename = complianceRecordFilename(p, agencyName, generatedAt, isDraft);
  return { pdf, filename };
}

/**
 * The download itself: one file in the Downloads folder, no dialog. Or, with
 * inline, opened in the browser's own PDF viewer (the licensee reading the
 * file on the sign-off page, 12 Oct 2026).
 */
export function auditPackResponse(pack: { pdf: Uint8Array; filename: string }, inline = false): Response {
  const { pdf, filename } = pack;
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // Both forms: the plain one for older browsers, the UTF-8 one for
      // everything current. An address with an apostrophe in it should not
      // produce a file called "download".
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The office's names as they stood when the file was finished: the later of
 * the two signatures. With no time on either, or no history to read, today's.
 */
async function namesWhenFinished(
  supabase: SupabaseClient,
  agencyId: string,
  current: AgencyNames,
  signedAt: Array<string | null>,
): Promise<AgencyNames> {
  const times = signedAt.filter((t): t is string => Boolean(t) && !Number.isNaN(Date.parse(t as string)));
  if (times.length === 0) return current;
  const finishedAt = times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
  const { data, error } = await supabase
    .from("agency_name_changes")
    .select("name_kind, old_name, new_name, changed_at")
    .eq("agency_id", agencyId)
    .gt("changed_at", finishedAt);
  if (error || !data) return current;
  return namesAsAt(current, data as NameChange[], finishedAt);
}
