"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { appendSignaturePage, buildSignatureCertificate } from "@/lib/pdf/sign-stamp";
import type { SignoffCategory, SignerScope } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

// ── Publishing a document for sign-off ─────────────────────────────────────
// Licensee-only, same as every other "this becomes the record" action in
// this app (SG Manual versions, PI insurance, etc.) — the licensee is the
// one accountable for what's in force. Pre-creates one unsigned row per
// required signer straight away, so the register can always show "3 of 5
// signed" rather than working that out from who's got around to it.
export async function createSignoffDocument(params: {
  category: SignoffCategory;
  title: string;
  periodLabel: string | null;
  /** First day of the month a trust reconciliation covers. Null elsewhere. */
  periodMonth?: string | null;
  /** Which trust account a reconciliation belongs to. Null elsewhere. */
  trustAccountId?: string | null;
  filePath: string;
  fileName: string;
  notes: string | null;
  signerScope: SignerScope;
}): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  // Trust reconciliations are the one exception to licensee-only publishing
  // (Adam, 25 Aug 2026: "I want the licensee or the licensee's assistant to be
  // able to [put] the PDF into RealComply so that the licensee can sign within
  // RealComply").
  //
  // The exception is narrow and it costs nothing, because uploading is not the
  // act that matters here. The signature is, and that stays licensee-only —
  // signerScope is forced to licensee_only below rather than trusted from the
  // caller, so an assistant cannot publish a trust document that they are then
  // able to sign themselves.
  const isReconciliation = params.category === "trust_reconciliation";
  const mayPublish =
    profile.is_licensee_in_charge || (isReconciliation && Boolean(profile.is_assistant));

  if (!mayPublish) {
    return isReconciliation
      ? { error: "Only the licensee in charge or their assistant can upload a trust reconciliation." }
      : { error: "Only the licensee in charge can publish a document for sign-off." };
  }

  const signerScope: SignerScope = isReconciliation ? "licensee_only" : params.signerScope;

  const { data: doc, error: docError } = await supabase
    .from("signoff_documents")
    .insert({
      agency_id: profile.agency_id,
      category: params.category,
      title: params.title,
      period_label: params.periodLabel,
      period_month: params.periodMonth ?? null,
      trust_account_id: params.trustAccountId ?? null,
      file_path: params.filePath,
      file_name: params.fileName,
      notes: params.notes,
      signer_scope: signerScope,
      uploaded_by: profile.id,
    })
    .select()
    .single();

  if (docError || !doc) {
    return { error: "Couldn't save that document — try again." };
  }

  const signers =
    signerScope === "all_staff"
      ? (await supabase.from("profiles").select("id").eq("agency_id", profile.agency_id)).data ?? []
      : (
          await supabase
            .from("profiles")
            .select("id")
            .eq("agency_id", profile.agency_id)
            .eq("is_licensee_in_charge", true)
        ).data ?? [];

  if (signers.length > 0) {
    const { error: sigError } = await supabase.from("signoff_signatures").insert(
      signers.map((s) => ({
        document_id: doc.id,
        agency_id: profile.agency_id,
        signer_id: s.id,
      })),
    );
    // The document itself is already saved at this point — a partial
    // signer-row failure shouldn't hide it, just surface a warning so
    // whoever's missing can be added by hand if this ever actually fires.
    if (sigError) {
      return { error: "Document saved, but couldn't set up all the sign-off rows — check the register." };
    }
  }

  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/registers");
  return ok;
}

// ── Signing your own row ────────────────────────────────────────────────
// RLS (0009_document_signoffs.sql) already restricts this to the caller's
// own signer_id — the is-it-really-them check is the auth session, same as
// sign_agent/sign_licensee on a compliance file. Upsert rather than a plain
// update so this still works even if a signer's row didn't exist yet (e.g.
// someone added to the agency after the document was published).
// A TICK, NOT A TYPED NAME (Adam, 8 Sep 2026): "we can just add a tick box
// stating that the licensee has reviewed the document and only the licensee
// can tick that box."
//
// Right, and it follows from the previous finding. Nothing requires a
// reconciliation to be SIGNED — see the note above SIGNED_BASIS — so a typed
// signature was dressing a review up as something the Act had asked for. What
// the licensee is actually attesting is that they looked at it, which is what
// s32(3)(c) wants evidence of, and a tick says that without pretending
// otherwise.
//
// IT IS NO WEAKER AS EVIDENCE. Electronic Transactions Act 2000 (NSW) s9 asks
// that the method identify the person and indicate their approval, and be as
// reliable as appropriate. A tick from an authenticated licensee-only account,
// timestamped, with the name taken from the profile rather than retyped, does
// all three — and the profile name is harder to get wrong than a string
// somebody types into a box.
//
// WHO MAY TICK IT is now checked here rather than left to RLS. The signature
// row's own policy stopped one person signing on another's behalf, but nothing
// stopped an assistant signing their OWN row on a licensee-only document. It
// has never been reachable from the interface, which is exactly why it was
// worth closing before somebody found a route to it: on this item the whole
// evidentiary value is that the licensee, and only the licensee, said yes.
export async function signDocument(documentId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: doc } = await supabase
    .from("signoff_documents")
    .select("id, title, file_path, file_name, category, period_label, signer_scope, signed_file_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) {
    return { error: "That document couldn't be found." };
  }

  const scope = (doc as { signer_scope?: string }).signer_scope;
  if (scope === "licensee_only" && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can sign this off." };
  }

  // The authenticated name, not a typed one. Falls back only so a profile
  // with no name recorded cannot block a sign-off.
  const typedName = String(profile.full_name ?? profile.email ?? "").trim();
  if (!typedName) {
    return { error: "Add your name in Settings before signing this off." };
  }

  const signedAt = new Date().toISOString();

  const { error } = await supabase.from("signoff_signatures").upsert(
    {
      document_id: documentId,
      agency_id: profile.agency_id,
      signer_id: profile.id,
      typed_name: typedName,
      signed_at: signedAt,
    },
    { onConflict: "document_id,signer_id" },
  );

  if (error) {
    return { error: "Couldn't record that signature — try again." };
  }

  // THEN PUT IT ON THE DOCUMENT.
  //
  // Deliberately after the signature row and deliberately not fatal. The row
  // is the signature; this is the signature made portable. If stamping fails —
  // a PDF we cannot open, storage having a bad minute — the licensee has still
  // signed and must not be told otherwise, so the failure is logged and the
  // action still succeeds. What must never happen is the reverse: a stamped
  // file with no row behind it.
  await stampSignedCopy(supabase, {
    documentId,
    agencyId: profile.agency_id,
    title: (doc as { title: string }).title,
    filePath: (doc as { file_path: string }).file_path,
    fileName: (doc as { file_name: string }).file_name,
    category: (doc as { category: string }).category,
  });

  revalidatePath("/dashboard/trust");
  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/registers");
  return ok;
}

// ── Adding the signature page to a document signed before it existed ─────
//
// Adam, 9 Sep 2026: "the sign pages on the trust account reconciliation
// reports aren't showing, something's dropped off."
//
// Nothing had dropped off. The signature page shipped on 8 September; three
// reconciliations were signed on the 4th and the 7th, and signing does not
// reach back in time. Those months are signed in the register and open as an
// unsigned report, which is the same defect Adam reported on 8 Sep wearing
// different clothes — the file that leaves the building does not carry the
// signature.
//
// WHY THIS EXISTS AND NOT "REPLACE AND RE-SIGN", which is what I first told
// him to do and was wrong. Replacing voids the signature and writes a new one
// dated today. The licensee reviewed the SALES account's July reconciliation
// on 7 September; that is a true fact about a trust record, it is the fact
// s32(3)(c) wants evidence of, and re-signing would overwrite it with 9
// September and note an amendment that never happened. Trading the real date
// of review for a cosmetic signature page is a bad trade on a record an
// auditor reads under s111 — the page is supposed to describe the signature,
// not replace it.
//
// So this changes NOTHING except producing the file that should have been
// produced at the time. No new signature, no new date, no amendment note. The
// page it generates reads "Signed 7 September 2026", because that is when it
// was signed. stampSignedCopy was already built to rebuild from the untouched
// original plus whatever signatures exist, so it needs no argument about when
// it is being called.
//
// Refuses when there is nothing to fix — no signature yet, or a signed copy
// already on file — rather than silently rebuilding a good document.
export async function restampSignedDocument(documentId: string): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const { data: doc } = await supabase
    .from("signoff_documents")
    .select("id, title, file_path, file_name, category, signer_scope, signed_file_path")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That document couldn't be found." };

  // Same gate as signing it. The page carries the licensee's name and the
  // basis on which it stands as their signature; who may (re)generate it is
  // not a smaller question than who may sign it.
  const scope = (doc as { signer_scope?: string }).signer_scope;
  if (scope === "licensee_only" && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can add the signature page to this document." };
  }

  if ((doc as { signed_file_path: string | null }).signed_file_path) {
    return { error: "This document already has its signature page." };
  }

  const { data: sig } = await supabase
    .from("signoff_signatures")
    .select("id")
    .eq("document_id", documentId)
    .not("signed_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (!sig) {
    return { error: "This document hasn't been signed off yet, so there's no signature to add." };
  }

  await stampSignedCopy(supabase, {
    documentId,
    agencyId: profile.agency_id,
    title: (doc as { title: string }).title,
    filePath: (doc as { file_path: string }).file_path,
    fileName: (doc as { file_name: string }).file_name,
    category: (doc as { category: string }).category,
  });

  // stampSignedCopy swallows its own failures by design — a signature must
  // never fail because a PDF would not open. Here that is the whole job, so
  // read back whether it landed and say so plainly rather than returning a
  // success that changes nothing on screen.
  const { data: after } = await supabase
    .from("signoff_documents")
    .select("signed_file_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!(after as { signed_file_path: string | null } | null)?.signed_file_path) {
    return { error: "Couldn't build the signature page for this one. Tell support — the signature itself is unaffected." };
  }

  revalidatePath("/dashboard/trust");
  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/registers");
  return ok;
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

async function stampSignedCopy(
  supabase: Awaited<ReturnType<typeof requireAuthContext>>["supabase"],
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
      .select("signer_id, typed_name, signed_at")
      .eq("document_id", p.documentId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: true });

    const signed = (sigRows ?? []) as Array<{
      signer_id: string;
      typed_name: string | null;
      signed_at: string;
    }>;
    if (signed.length === 0) return;

    const { data: people } = await supabase
      .from("profiles")
      .select("id, full_name, email, is_licensee_in_charge")
      .in(
        "id",
        signed.map((r) => r.signer_id),
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
        const who = profileById.get(r.signer_id);
        return {
          // The profile name is authoritative; typed_name is what the older
          // typed-signature flow recorded and is the fallback for rows written
          // before the tick box replaced it on 8 Sep 2026.
          name: who?.full_name ?? r.typed_name ?? who?.email ?? "Unknown",
          role: who?.is_licensee_in_charge ? "Licensee in charge" : "Staff member",
          signedAt: r.signed_at,
        };
      }),
      documentFileName: p.fileName,
      legalBasis: SIGNED_BASIS[p.category],
    };

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


// ── Replacing a document that is already on file ────────────────────────
//
// Adam, 8 Sep 2026: "I accidentally put August's report in the July section
// and signed it off. Now I can't see a way to go back and reopen it to amend
// the document."
//
// A real gap, and the fix has to be shaped by what these records ARE. cl 27(5)
// (b) of the Regulation requires the licensee to prepare a monthly statement
// reconciling the trust account against the cash book, and it carries a
// penalty. The signature on it is the licensee's assertion that they did that,
// for that month, on that date.
//
// So the wrong fix is a silent file swap. That would leave a signature dated
// 5 August attached to a document uploaded on 8 September, asserting something
// about July that the licensee never actually reviewed on the date shown — a
// record that is wrong in a way nobody can see, which is worse than the
// original mistake, which at least announced itself.
//
// THREE RULES, and each is here for that reason:
//
//   1. Replacing a SIGNED document VOIDS the signature. The month drops back
//      to "waiting on the licensee" and has to be signed again. The new
//      signature then carries the date the licensee actually reviewed the
//      right report.
//   2. The replacement is RECORDED, in notes, with what was replaced, by whom
//      and when. An amended record that shows it was amended is evidence; one
//      that hides it is a liability.
//   3. The old file is NOT deleted from storage. It is a trust record, s104
//      keeps records for three years, and a wrong file in the wrong month is
//      still a document that existed. Orphaning it costs a few kilobytes;
//      destroying it costs the ability to explain what happened.
//
// Licensee only, like the signature itself.
export async function replaceSignoffDocument(
  documentId: string,
  params: { filePath: string; fileName: string },
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can replace a report that is already on file." };
  }

  const { data: doc } = await supabase
    .from("signoff_documents")
    .select("id, file_name, notes")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { error: "That document couldn't be found." };

  const previous = (doc as { file_name: string | null }).file_name ?? "the previous file";
  const existingNotes = (doc as { notes: string | null }).notes;
  const when = new Date().toISOString().slice(0, 10);
  const by = profile.full_name ?? profile.email ?? "the licensee in charge";
  const line = `Replaced ${when} by ${by}. Previous file: ${previous}. Any signature on the previous file was voided and the report re-signed.`;

  const { error } = await supabase
    .from("signoff_documents")
    .update({
      file_path: params.filePath,
      file_name: params.fileName,
      // The old signed copy is cleared with the signature it carried. Leaving
      // it would be the worst of both: a month showing "waiting on the
      // licensee" that opens a document with a signature page on it.
      signed_file_path: null,
      signed_file_name: null,
      notes: existingNotes ? `${existingNotes}\n${line}` : line,
    })
    .eq("id", documentId);

  if (error) {
    console.error("replaceSignoffDocument failed:", documentId, error.message);
    return { error: "Couldn't replace that report — try again." };
  }

  // Rule 1. Cleared rather than deleted, so the signer row survives and the
  // month reads as "waiting on the licensee" rather than "not uploaded".
  const { error: sigError } = await supabase
    .from("signoff_signatures")
    .update({ signed_at: null, typed_name: null })
    .eq("document_id", documentId);

  if (sigError) {
    console.error("voiding signature failed:", documentId, sigError.message);
    return { error: "The file was replaced but the old signature could not be cleared. Tell support before signing again." };
  }

  revalidatePath("/dashboard/trust");
  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/registers");
  return ok;
}

export async function deleteSignoffDocument(documentId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;

  await supabase.from("signoff_documents").delete().eq("id", documentId);
  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/registers");
}
