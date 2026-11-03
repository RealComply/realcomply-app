import type { SupabaseClient } from "@supabase/supabase-js";
import { EVIDENCE_BUCKET, isInFolder } from "@/lib/storage/evidence";
import { appendSignaturePage, buildSignatureCertificate } from "@/lib/pdf/sign-stamp";
import { monthName } from "@/lib/licensee-signoff/model";

// The signed copy of a trust reconciliation or an SG Manual version: the
// original with a signature page listing everyone who has signed. Moved here
// from lib/actions/signoffs.ts (3 Nov 2026) so the monthly pack and the
// licensee's email links can use it too: a "use server" file's exports can
// be called from the browser, and this one reads with full rights.

/** How a licensee in charge with no login signed (0109), for their line on the signature page. */
export function licenseeWithoutLoginRole(via: string | null | undefined, packMonth: string | null): string {
  if (via === "pack" || (via === "link" && packMonth)) {
    return packMonth ? `Licensee in charge, in the ${packMonth} pack` : "Licensee in charge, in the monthly pack";
  }
  return "Licensee in charge, signed through an emailed link";
}

// The line printed on the signature page naming the obligation the DOCUMENT
// answers — not the signature.
//
// The distinction is deliberate and Adam asked the question that produced it
// (8 Sep 2026): does anything actually require the reconciliation to be
// signed? Checked against the text, and no. cl 27(5)(b) says the licensee must
// "prepare a statement reconciling" — prepare, not sign. cl 30(2)(a) wants the
// trial balance to specify its month and date of preparation, and says nothing
// about a signature. cl 31 requires the records be kept and producible on
// demand. The only signature the trust provisions require anywhere near this
// is cl 25(3)(d): a trust account CHEQUE must be signed by the licensee in
// charge.
//
// So the sign-off is our control, not the Act's, and it earns its place under
// s32 instead — the licensee must properly supervise, which s32(3)(b) and (c)
// spell out as establishing procedures and monitoring that they are followed.
// A dated record that the licensee in charge reviewed each month's
// reconciliation is exactly that evidence, and it is what an auditor under
// s111 asks to see.
//
// Which is why the page labels this clause as the record's basis and never
// claims the signature is required by it.
const SIGNED_BASIS: Record<string, string> = {
  trust_reconciliation:
    "cl 27(5)(b) and cl 30(1), Property and Stock Agents Regulation 2022 (NSW)",
  sg_manual: "s32, Property and Stock Agents Act 2002 (NSW) — supervision guidelines",
};

export async function stampSignedCopy(
  client: () => SupabaseClient,
  p: {
    documentId: string;
    agencyId: string;
    title: string;
    filePath: string;
    fileName: string;
    category: string;
  },
): Promise<void> {
  try {
    const supabase = client();
    // The agency's own name, off the agency row rather than the profile —
    // profiles do not carry it. This is the agency's record and the page says
    // so at the top; falling back to a generic label would produce a signature
    // page that could belong to anybody.
    const { data: agency } = await supabase
      .from("agencies")
      .select("name")
      .eq("id", p.agencyId)
      .maybeSingle();

    // EVERY signature on this document, oldest first — not just the one that
    // triggered this call. An SG version is signed by all staff, and rebuilding
    // the copy from the last signature alone would drop everyone before them.
    // Reading them back also makes the whole thing idempotent: the copy is
    // always the original plus a page describing the current state of the
    // signature table, whatever order people signed in.
    const { data: sigRows } = await supabase
      .from("signoff_signatures")
      .select("signer_id, typed_name, signed_at, signed_via")
      .eq("document_id", p.documentId)
      // Only this office's rows: this reads with full rights, and a row from
      // anywhere else must never put a name on this office's page (review of
      // these fixes, 10 Oct 2026; the database also stops rows being moved).
      .eq("agency_id", p.agencyId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: true });

    const signed = (sigRows ?? []) as Array<{
      signer_id: string | null;
      typed_name: string | null;
      signed_at: string;
      signed_via?: string | null;
    }>;
    if (signed.length === 0) return;

    // Signed in a monthly pack (0109): which month, for the line on the page.
    let packMonthOf: string | null = null;
    if (signed.some((r) => r.signed_via === "pack" || r.signed_via === "link")) {
      const { data: packItem } = await supabase
        .from("signoff_pack_items")
        .select("signoff_packs(month)")
        .eq("agency_id", p.agencyId)
        .eq("item_id", p.documentId)
        .not("signed_at", "is", null)
        .limit(1)
        .maybeSingle();
      const month = (packItem as { signoff_packs?: { month?: string } | null } | null)?.signoff_packs?.month;
      packMonthOf = month ? monthName(month) : null;
    }

    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_licensee_in_charge")
      .in(
        "id",
        signed.map((r) => r.signer_id).filter((id): id is string => Boolean(id)),
      );

    const profileById = new Map(
      ((people ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        is_licensee_in_charge: boolean | null;
      }>).map((r) => [r.id, r]),
    );

    const stamp = {
      title: p.title,
      agencyName: (agency as { name?: string } | null)?.name ?? "This agency",
      signatories: signed.map((r) => {
        // A licensee in charge with no login (0109): the name they typed, and
        // how it reached them.
        if (!r.signer_id) {
          return {
            name: r.typed_name ?? "The licensee in charge",
            email: null,
            role: licenseeWithoutLoginRole(r.signed_via, packMonthOf),
            signedAt: r.signed_at,
          };
        }
        const who = profileById.get(r.signer_id);
        return {
          // The profile name is authoritative; typed_name is what the older
          // typed-signature flow recorded and is the fallback for rows written
          // before the tick box replaced it on 8 Sep 2026.
          name: who?.full_name ?? r.typed_name ?? who?.email ?? "Unknown",
          email: who?.email ?? null,
          role: who?.is_licensee_in_charge
            ? r.signed_via === "pack" && packMonthOf
              ? `Licensee in charge, in the ${packMonthOf} pack`
              : "Licensee in charge"
            : "Staff member",
          signedAt: r.signed_at,
        };
      }),
      documentFileName: p.fileName,
      legalBasis: SIGNED_BASIS[p.category],
    };

    // Read with full rights, so only from this office's own folder (19 Oct
    // 2026). The database refuses any other path on the document (0083);
    // this is the same rule where the full-rights read happens.
    if (!isInFolder(p.filePath, `${p.agencyId}/`)) {
      console.error("stampSignedCopy: file outside the office's folder, not read:", p.documentId);
      return;
    }
    const { data: blob, error: dlError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .download(p.filePath);

    let bytes: Uint8Array | null = null;
    let suffix = "signed.pdf";

    if (blob && !dlError) {
      const original = new Uint8Array(await blob.arrayBuffer());
      bytes = await appendSignaturePage(original, stamp);
      if (bytes) {
        // "Report July 2026.pdf" -> "Report July 2026 (signed).pdf"
        suffix = `${p.fileName.replace(/\.pdf$/i, "")} (signed).pdf`;
      }
    } else if (dlError) {
      console.error("stampSignedCopy download failed:", p.filePath, dlError.message);
    }

    if (!bytes) {
      // Not a PDF we could open, or the original could not be read. A
      // standalone certificate still gives the agency a signature they can
      // file and send.
      bytes = await buildSignatureCertificate(stamp);
      suffix = `${p.fileName.replace(/\.[^.]+$/, "")} — signature.pdf`;
    }

    const path = `${p.agencyId}/_signoffs/signed/${Date.now()}-${suffix.replace(/[^A-Za-z0-9._ ()-]/g, "_")}`;
    const { error: upError } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: false });

    if (upError) {
      console.error("stampSignedCopy upload failed:", path, upError.message);
      return;
    }

    const { error: saveError } = await supabase
      .from("signoff_documents")
      .update({ signed_file_path: path, signed_file_name: suffix })
      .eq("id", p.documentId);

    if (saveError) {
      console.error("stampSignedCopy save failed:", p.documentId, saveError.message);
    }
  } catch (e) {
    console.error("stampSignedCopy threw:", e instanceof Error ? e.message : e);
  }
}
