import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { buildComplianceRecordPdf, complianceRecordFilename, type Attachment } from "@/lib/pdf/compliance-record";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Property, PropertyItem } from "@/lib/types";

// One click, one file in the Downloads folder.
//
// Content-Disposition: attachment is the whole point — it makes the browser
// save the file rather than display it, with no dialog and no decision. See the
// note on buildComplianceRecordPdf for why this matters more than convenience.
//
// Auth is the same as the page it sits under: requireProfile establishes the
// session, and RLS scopes the property lookup to the caller's own agency, so a
// guessed property id returns nothing rather than somebody else's file.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: property } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!property) notFound();
  const p = property as Property;

  // The agency leads the document (Adam, 23 Aug 2026): their logo where they
  // have one, the office name, then the agent whose file this is.
  //
  // Keyed off whether a logo EXISTS rather than off a subscription tier. The
  // tiers do not exist yet and this does not need them: an office that uploads
  // one gets it, an individual agent who has none gets the text masthead, which
  // is the correct output for them rather than a degraded one.
  const [{ data: agencyRow }, { data: agentRow }] = await Promise.all([
    supabase.from("agencies").select("name, logo_path").eq("id", profile.agency_id).maybeSingle(),
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

  const { data: rows } = await supabase.from("property_items").select("*").eq("property_id", id);
  const byKey = Object.fromEntries(((rows ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
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
    signatures: { agent: signatureOf("sign_agent"), licensee: signatureOf("sign_licensee") },
    attachments,
    rulesetVersion: RULESET_VERSION,
    preparedFor: profile.full_name ?? profile.email,
    generatedAt,
  });

  const filename = complianceRecordFilename(p, agencyName, generatedAt);

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
