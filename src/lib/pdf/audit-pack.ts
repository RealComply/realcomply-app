import type { SupabaseClient } from "@supabase/supabase-js";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { buildComplianceRecordPdf, complianceRecordFilename, type Attachment } from "@/lib/pdf/compliance-record";
import { comparablesFor } from "@/lib/data/comparables";
import { marketListingsFor } from "@/lib/data/market-listings";
import { withEffectiveEspStatus } from "@/lib/rules/esp-reasoning-gate";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Property, PropertyItem } from "@/lib/types";

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
    supabase.from("agencies").select("name, logo_path").eq("id", agencyId).maybeSingle(),
    p.created_by
      ? supabase.from("profiles").select("full_name, email").eq("id", p.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const agency = agencyRow as { name?: string; logo_path?: string | null } | null;
  const agent = agentRow as { full_name?: string | null; email?: string } | null;
  const agencyName = agency?.name ?? "Your agency";
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

  const signatureOf = (key: string) => {
    const d = byKey[key]?.data as { typedName?: string; signedAt?: string } | undefined;
    return d?.typedName ? { typedName: d.typedName, signedAt: d.signedAt ?? null } : null;
  };

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
  const agentSignature = signatureOf("sign_agent");
  const licenseeSignature = signatureOf("sign_licensee");
  const isDraft = !agentSignature || !licenseeSignature;

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
      attachments.push(
        blob
          ? { title, fileName, bytes: new Uint8Array(await blob.arrayBuffer()), kind }
          : { title, fileName, bytes: null, kind, omittedBecause: "could not be read" },
      );
    } catch {
      attachments.push({ title, fileName, bytes: null, kind, omittedBecause: "could not be read" });
    }
  }

  const generatedAt = new Date();
  const pdf = await buildComplianceRecordPdf({
    property: p,
    agencyName,
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
    signatures: { agent: agentSignature, licensee: licenseeSignature },
    attachments,
    rulesetVersion: RULESET_VERSION,
    preparedFor,
    generatedAt,
  });

  const filename = complianceRecordFilename(p, agencyName, generatedAt, isDraft);
  return { pdf, filename };
}

/** The download itself: one file in the Downloads folder, no dialog. */
export function auditPackResponse(pack: { pdf: Uint8Array; filename: string }): Response {
  const { pdf, filename } = pack;
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // Both forms: the plain one for older browsers, the UTF-8 one for
      // everything current. An address with an apostrophe in it should not
      // produce a file called "download".
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
