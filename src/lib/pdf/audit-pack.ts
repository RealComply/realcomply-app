import type { SupabaseClient } from "@supabase/supabase-js";
import { withdrawalHistory } from "@/lib/data/withdrawals";
import { withdrawalRecordLines } from "@/lib/rules/listing-tabs";
import { keepUntilLineFor } from "@/lib/rules/agreement-keep-until";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import {
  buildComplianceRecordPdf,
  complianceRecordFilename,
  type LoadedDocument,
  type ComplaintForRecord,
} from "@/lib/pdf/compliance-record";
import { comparablesFor } from "@/lib/data/comparables";
import { marketListingsFor } from "@/lib/data/market-listings";
import { withEffectiveEspStatus } from "@/lib/rules/esp-reasoning-gate";
import { linkRequestNeedingTime, signatureOnCard } from "@/lib/rules/listing-signature";
import { priceApprovalFor } from "@/lib/data/price-approval";
import { priceApproval } from "@/lib/rules/price-statement";
import { espRevisionsFor } from "@/lib/data/esp-revisions";
import {
  approvalLines,
  cancelledBecause,
  espPackRows,
  revisionsOrCard,
  type ApprovalEvent,
  type EspPackRow,
  type EspRevision,
} from "@/lib/esp-history";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import { EVIDENCE_BUCKET, complaintFolder, isInFolder, listingFolder } from "@/lib/storage/evidence";
import { packDocKind, packDocumentsFor, type PackDocument } from "@/lib/pdf/pack-documents";
import { PACK_DOCUMENTS_MAX_BYTES } from "@/lib/pdf/audit-pack-store";
import { copiesBeforeSigning } from "@/lib/links/delivery";
import { readableBytes } from "@/lib/documents/readable-bytes";
import { EMPTY_FILE_MESSAGE, downloadedFileProblem } from "@/lib/storage/file-check";
import { addedLine, complaintFilesFor, removedLine } from "@/lib/complaint-files";
import { formatAuDate } from "@/lib/format-date";
import type { Complaint, ComplaintFile, Property, PropertyItem } from "@/lib/types";
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
): Promise<{ pdf: Uint8Array; filename: string; included: string[] } | null> {
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
  //
  // Some callers pass the full-rights client, so only from the office's own
  // folder (20 Oct 2026; 0085 refuses any other path on the office).
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (agency?.logo_path && isInFolder(agency.logo_path, `${agencyId}/`)) {
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
  const copiedBeforeSigning = async (signedAt: string | null): Promise<{ by: string; at: string } | null> => {
    const requestId = (byKey["sign_licensee"]?.data as { signoffRequestId?: unknown } | undefined)?.signoffRequestId;
    if (typeof requestId !== "string" || !requestId || !signedAt) return null;
    const { data: copies } = await supabase
      .from("signoff_link_copies")
      .select("copied_by_name, copied_at")
      .eq("request_id", requestId)
      .eq("agency_id", agencyId)
      .order("copied_at");
    const trail = copiesBeforeSigning(
      ((copies ?? []) as Array<{ copied_by_name: string; copied_at: string }>).map((c) => ({ by: c.copied_by_name, at: c.copied_at })),
      signedAt,
    );
    return trail[0] ?? null;
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
  // Signed through the link RealComply emailed: the address it went to, on
  // the record (Master, 4 Nov 2026; 0112).
  const emailedTo = async (): Promise<string | null> => {
    const data = byKey["sign_licensee"]?.data as { signoffRequestId?: unknown; signedVia?: unknown } | undefined;
    const requestId = data?.signoffRequestId;
    if (data?.signedVia !== "link" || typeof requestId !== "string" || !requestId) return null;
    const { data: request } = await supabase
      .from("property_signoff_requests")
      .select("sent_to")
      .eq("id", requestId)
      .eq("agency_id", agencyId)
      .eq("item_key", "sign_licensee")
      .maybeSingle();
    const sentTo = (request as { sent_to?: string | null } | null)?.sent_to?.trim();
    return sentTo || null;
  };

  const agentSignature = await signatureOf("sign_agent");
  const licenseeSigned = await signatureOf("sign_licensee");
  // Signed through a link someone copied to send by hand (option 2, Adam
  // 3 Nov 2026; 0107): the first copy before the signature goes on the record.
  // Signed in a monthly sign-off pack (0109): which month, for its line.
  const packMonth = async (): Promise<string | null> => {
    const packId = (byKey["sign_licensee"]?.data as { packId?: unknown } | undefined)?.packId;
    if (typeof packId !== "string") return null;
    const { data } = await supabase.from("signoff_packs").select("month").eq("agency_id", agencyId).eq("id", packId).maybeSingle();
    return ((data as { month?: string } | null)?.month as string | undefined) ?? null;
  };
  const licenseeSignature = licenseeSigned
    ? { ...licenseeSigned, copiedLink: await copiedBeforeSigning(licenseeSigned.signedAt), emailedTo: await emailedTo(), packMonth: await packMonth() }
    : null;
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

  // EVERY DOCUMENT ON THE LISTING (Adam, 2 Nov 2026). Was: the comparable
  // sales report (a4) and the ESP revision notice (d3) only, "deliberately not
  // the contract for sale" to keep the record emailable (24 Aug 2026). Now:
  // every current file on every card, in the record's order, with who
  // uploaded it and when; then the files on complaints linked to the listing.
  // See the CHANGE note in lib/pdf/compliance-record.ts.
  //
  // Who uploaded each file and when is Storage's own record (0106). Before
  // 0106 runs this reads nothing, and the time comes from the file's stored
  // name instead.
  const { data: uploadRows } = await supabase.rpc("listing_file_uploads", { p_property_id: id });
  const uploads = new Map(
    ((uploadRows ?? []) as Array<{ path: string; uploaded_by_name: string | null; uploaded_at: string | null }>).map((r) => [
      r.path,
      { by: r.uploaded_by_name, at: r.uploaded_at },
    ]),
  );
  const documents = packDocumentsFor(items, byKey, listingFolder(agencyId, id), uploads);

  // Withdrawn from sale, and put back (Job B, 0114): a line each in the
  // record, and any evidence in the pack.
  const withdrawals = await withdrawalHistory(supabase as never, id);
  const withdrawalNames = new Map<string, string>();
  if (withdrawals.length > 0) {
    const { data: who } = await supabase.from("profiles").select("id, full_name, email").eq("agency_id", agencyId);
    for (const x of (who ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      withdrawalNames.set(x.id, x.full_name ?? x.email);
    }
  }
  const withdrawalLines = withdrawalRecordLines(withdrawals, (pid) => (pid && withdrawalNames.get(pid)) || "a team member");
  for (const w of withdrawals) {
    if (!w.evidence_path || !isInFolder(w.evidence_path, `${listingFolder(agencyId, id)}withdrawal/`)) continue;
    const fileName = w.evidence_file_name ?? "Withdrawal evidence";
    documents.push({
      stage: "Withdrawn from sale",
      cardTitle: "Withdrawal evidence",
      fileName,
      path: w.evidence_path,
      kind: packDocKind(fileName),
      uploadedBy: (w.withdrawn_by && withdrawalNames.get(w.withdrawn_by)) || null,
      uploadedAt: w.withdrawn_at,
    });
  }

  // EVERY ESP REVISION, WITH ITS NOTICE (Adam, 3 Nov 2026; 0110). The card
  // names the latest notice only; each earlier revision's notice goes in just
  // before it, oldest first, so every version's evidence is in the pack. The
  // page "Estimated selling price: every change" links to each.
  const revisions = revisionsOrCard(await espRevisionsFor(supabase, agencyId, id), byKey["d3"]);
  const espHistory = revisions.length > 0 ? await espHistoryPage(supabase, agencyId, id, byKey, revisions, documents, uploads) : null;

  // Complaints the office linked to this listing, and their files (0101).
  // Read with the client passed in, so with a signed-in user's own access
  // only the licensee in charge's pack has them, or an office manager's
  // since 0102, as on the register. The full-rights callers (above) are kept
  // to this one office by its id. Their files follow the listing's own.
  const linked = await complaintsFor(supabase, agencyId, id);
  documents.push(...linked.documents);

  // Each file fetched as the pack reaches it, never all at once. A file that
  // can't be used says why on its separator page; the pack still builds.
  const loadDocument = async (d: PackDocument): Promise<LoadedDocument> => {
    try {
      const { data: blob } = await supabase.storage.from(EVIDENCE_BUCKET).download(d.path);
      if (!blob) return { problem: "it couldn't be read" };
      const unreadable = await downloadedFileProblem(blob, d.fileName);
      if (unreadable) return { problem: unreadable === EMPTY_FILE_MESSAGE ? "it came through empty" : "it didn't come through whole" };
      if (d.kind === "heic") {
        // An iPhone photo from before photos were converted on upload (26 Aug 2026).
        const readable = await readableBytes(blob, d.fileName);
        return readable.convertedFromHeic ? { bytes: readable.bytes } : { problem: "this iPhone photo couldn't be converted" };
      }
      return { bytes: new Uint8Array(await blob.arrayBuffer()) };
    } catch {
      return { problem: "it couldn't be read" };
    }
  };
  const included: string[] = [];

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
    withdrawalLines,
    agreementKeepUntil: keepUntilLineFor(
      { a3: byKey["a3"], d3: byKey["d3"], f5: byKey["f5"] },
      withdrawals.find((w) => !w.put_back_at)?.withdrawn_on ?? null,
    ),
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
    // The price statement card (b4): who ticked it and when (2 Nov 2026 on),
    // or what the licensee approved before then, and how: in the app, or
    // through the emailed link (0066).
    priceApproval: await priceApprovalFor(supabase, byKey["b4"]),
    espHistory,
    complaints: linked.complaints,
    signatures: { agent: agentSignature, licensee: licenseeSignature },
    documents,
    loadDocument,
    maxDocumentBytes: PACK_DOCUMENTS_MAX_BYTES,
    report: (path, inPdf) => {
      if (inPdf) included.push(path);
    },
    rulesetVersion: RULESET_VERSION,
    preparedFor,
    generatedAt,
  });

  const filename = complianceRecordFilename(p, agencyName, generatedAt, isDraft);
  return { pdf, filename, included };
}

/**
 * The ESP revision notices in the pack, and the page "Estimated selling price:
 * every change" (Adam, 3 Nov 2026): Version, ESP, Date, Recorded by and
 * Evidence, each evidence a link to its document's page; then the price
 * statement approvals and cancellations in date order. Adds each earlier
 * revision's notice to `documents`, just before the latest's.
 */
async function espHistoryPage(
  supabase: SupabaseClient,
  agencyId: string,
  propertyId: string,
  byKey: Record<string, PropertyItem>,
  revisions: EspRevision[],
  documents: PackDocument[],
  uploads: Map<string, { by: string | null; at: string | null }>,
): Promise<{ rows: EspPackRow[]; approvals: string[] }> {
  const folder = listingFolder(agencyId, propertyId);
  const latest = revisions[revisions.length - 1];
  const at = documents.findIndex((d) => d.path === latest.noticePath);
  const stage = at >= 0 ? documents[at].stage : "Other documents on this listing";
  if (at >= 0) documents[at] = { ...documents[at], cardTitle: `ESP revision notice, Revision ${latest.no} (latest)` };
  const earlier: PackDocument[] = revisions
    .slice(0, -1)
    .filter((r) => isInFolder(r.noticePath, folder) && !documents.some((d) => d.path === r.noticePath))
    .map((r) => {
      const fileName = r.noticeFileName ?? r.noticePath.split("/").pop() ?? "notice";
      return {
        stage,
        cardTitle: `ESP revision notice, Revision ${r.no}`,
        fileName,
        path: r.noticePath,
        kind: packDocKind(fileName),
        uploadedBy: uploads.get(r.noticePath)?.by ?? r.recordedByName,
        uploadedAt: uploads.get(r.noticePath)?.at ?? (r.recordedAt || null),
      };
    });
  documents.splice(at >= 0 ? at : documents.length, 0, ...earlier);

  // Each revision's evidence given to the seller (0117), just after its notice.
  for (const r of revisions) {
    const path = r.evidencePath;
    if (!path || !isInFolder(path, folder) || documents.some((d) => d.path === path)) continue;
    const fileName = r.evidenceFileName ?? path.split("/").pop() ?? "evidence";
    const notice = documents.findIndex((d) => d.path === r.noticePath);
    documents.splice(notice >= 0 ? notice + 1 : documents.length, 0, {
      stage,
      cardTitle: `ESP revision evidence, Revision ${r.no}`,
      fileName,
      path,
      kind: packDocKind(fileName),
      uploadedBy: uploads.get(path)?.by ?? r.recordedByName,
      uploadedAt: uploads.get(path)?.at ?? (r.recordedAt || null),
    });
  }

  const a4 = (byKey["a4"]?.data ?? {}) as { espLow?: unknown; espHigh?: unknown };
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
  const agreementPath = byKey["a3"]?.evidence_path && isInFolder(byKey["a3"].evidence_path, folder) ? byKey["a3"].evidence_path : null;
  const rows = espPackRows(
    { low: num(a4.espLow), high: num(a4.espHigh), agreementDate: byKey["a3"]?.event_date ?? null, agreementPath },
    revisions,
  );

  // The approvals: each cancelled one (the card as it stood, 0100), and the current one.
  const { data: cancelRows } = await supabase
    .from("listing_signoff_cancellations")
    .select("card, cancelled_at, because, because_item_key")
    .eq("agency_id", agencyId)
    .eq("property_id", propertyId)
    .eq("item_key", "b4");
  const cancels = (cancelRows ?? []) as Array<{ card: unknown; cancelled_at: string; because: string; because_item_key: string | null }>;
  const cards = [...cancels.map((c) => c.card as PropertyItem), byKey["b4"]].filter(Boolean) as PropertyItem[];
  const ids = [
    ...new Set(
      cards
        .flatMap((c) => [(c.data as { tickedBy?: unknown } | null)?.tickedBy, c.completed_by])
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const { data: people } = ids.length > 0 ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
  const names = new Map(((people ?? []) as Array<{ id: string; full_name: string | null }>).map((x) => [x.id, { full_name: x.full_name }]));
  const events: ApprovalEvent[] = [];
  const approved = (row: PropertyItem | null | undefined) => {
    const a = priceApproval(row, names);
    if (a?.at && !events.some((e) => e.kind === "approved" && e.at === a.at)) events.push({ kind: "approved", at: a.at, by: a.name, because: null });
  };
  for (const c of cancels) {
    approved(c.card as PropertyItem);
    events.push({
      kind: "cancelled",
      at: c.cancelled_at,
      by: null,
      because: cancelledBecause({ because: c.because, becauseItemKey: c.because_item_key, cancelledAt: c.cancelled_at }, revisions),
    });
  }
  approved(byKey["b4"]);
  return { rows, approvals: approvalLines(events) };
}

const COMPLAINT_STATUS: Record<string, string> = { open: "Open", under_review: "Under review", resolved: "Resolved" };

/**
 * The complaints linked to one listing, for its audit pack, and the files on
 * them to append. Each file only from its own complaint's folder. None at all
 * where the client may not see complaints, or before 0101 has run for the files.
 */
async function complaintsFor(
  supabase: SupabaseClient,
  agencyId: string,
  propertyId: string,
): Promise<{ complaints: ComplaintForRecord[]; documents: PackDocument[] }> {
  const { data: rows } = await supabase
    .from("complaints")
    .select("*")
    .eq("agency_id", agencyId)
    .eq("property_id", propertyId)
    .order("received_date", { ascending: true });
  const complaints = (rows ?? []) as Complaint[];
  if (complaints.length === 0) return { complaints: [], documents: [] };

  const { data: fileRows } = await supabase
    .from("complaint_files")
    .select("*")
    .eq("agency_id", agencyId)
    .in(
      "complaint_id",
      complaints.map((c) => c.id),
    )
    .order("added_at", { ascending: true });
  const files = (fileRows ?? []) as ComplaintFile[];

  const nameOf: Record<string, string> = {};
  if (files.length > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, email").eq("agency_id", agencyId);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      nameOf[p.id] = p.full_name ?? p.email;
    }
  }

  const forRecord: ComplaintForRecord[] = [];
  const documents: PackDocument[] = [];
  for (const c of complaints) {
    const { current, removed } = complaintFilesFor(c.id, files);
    const received = formatAuDate(c.received_date);
    forRecord.push({
      received,
      complainant: c.complainant,
      nature: c.nature,
      status:
        c.status === "resolved" && c.resolved_date
          ? `Resolved ${formatAuDate(c.resolved_date)}`
          : (COMPLAINT_STATUS[c.status] ?? c.status),
      files: current.map((f) => `${f.file_name} · ${addedLine(f, nameOf)}`),
      removed: removed.map((f) => `${f.file_name} · ${removedLine(f, nameOf)}`),
    });
    for (const f of current) {
      if (!isInFolder(f.file_path, complaintFolder(agencyId, c.id))) continue;
      documents.push({
        stage: "Complaints",
        cardTitle: `Complaint received ${received}`,
        fileName: f.file_name,
        uploadedBy: f.added_by ? (nameOf[f.added_by] ?? null) : null,
        uploadedAt: f.added_at,
        path: f.file_path,
        kind: packDocKind(f.file_name),
      });
    }
  }
  return { complaints: forRecord, documents };
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
