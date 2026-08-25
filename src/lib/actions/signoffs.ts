"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
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
export async function signDocument(documentId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const typedName = String(formData.get("typedName") ?? "").trim();
  if (!typedName) {
    return { error: "Type your full name to adopt it as your signature." };
  }

  const { data: doc } = await supabase.from("signoff_documents").select("id").eq("id", documentId).maybeSingle();
  if (!doc) {
    return { error: "That document couldn't be found." };
  }

  const { error } = await supabase.from("signoff_signatures").upsert(
    {
      document_id: documentId,
      agency_id: profile.agency_id,
      signer_id: profile.id,
      typed_name: typedName,
      signed_at: new Date().toISOString(),
    },
    { onConflict: "document_id,signer_id" },
  );

  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  return { error: error ? "Couldn't record that signature — try again." : null };
}

export async function deleteSignoffDocument(documentId: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();
  if (!profile.is_licensee_in_charge) return;

  await supabase.from("signoff_documents").delete().eq("id", documentId);
  revalidatePath("/dashboard/document-signoffs");
  revalidatePath("/dashboard/sg-manual");
  revalidatePath("/dashboard/registers");
}
