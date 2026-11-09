import type { SupabaseClient } from "@supabase/supabase-js";
import { failedReadSentence } from "@/lib/documents/read-core";
import type { PendingRevision } from "@/lib/esp-history";

// Reading a revised-ESP notice into the d3 card's draft (Adam, 3 Nov 2026;
// 0110). The figures come off the notice, as before, but they go into the
// draft (data.pending), not over the latest revision: nothing on this card is
// ever written over. The agent checks them and saves, which records a new
// revision (record_esp_revision).
//
// Server-only. Never throws: what went wrong is on the draft, and the card says.

export async function readNoticeIntoPending(
  supabase: SupabaseClient,
  args: { agencyId: string; propertyId: string; path: string; fileName: string },
): Promise<{ error: string | null }> {
  const { extractRevisedEspNotice } = await import("@/lib/actions/extraction");
  const pending: PendingRevision = {
    path: args.path,
    fileName: args.fileName,
    uploadedAt: new Date().toISOString(),
    low: null,
    high: null,
    givenOn: null,
    methodOfService: null,
    reason: null,
    evidenceProvidedBeforeNotice: null,
    readFailed: null,
    notRecognised: false,
  };
  let error: string | null = null;

  const result = await extractRevisedEspNotice(
    supabase as Parameters<typeof extractRevisedEspNotice>[0],
    args.path,
    args.fileName,
    args.propertyId,
  ).catch(() => ({ ok: false as const, why: "other" as const }));
  if (!result.ok) {
    pending.readFailed = failedReadSentence(
      result.why,
      "the notice",
      "Type the figures from the notice, or upload a clearer copy.",
      "The notice couldn't be read. Type the figures from it, or upload a clearer copy.",
    );
  } else if (result.fields.looksLikeRevisedEspNotice === false) {
    pending.notRecognised = true;
    error = "That doesn't look like a notice revising the estimated selling price. Upload the notice you gave the seller.";
  } else {
    const f = result.fields;
    // Both figures or neither: half a range is a half-read document.
    const both = f.revisedEspLow != null && f.revisedEspHigh != null;
    pending.low = both ? Number(f.revisedEspLow) : null;
    pending.high = both ? Number(f.revisedEspHigh) : null;
    pending.givenOn = typeof f.noticeServedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.noticeServedOn) ? f.noticeServedOn : null;
    pending.methodOfService = f.methodOfService ?? null;
    pending.reason = f.reason ?? null;
    pending.evidenceProvidedBeforeNotice = typeof f.evidenceProvidedBeforeNotice === "boolean" ? f.evidenceProvidedBeforeNotice : null;
    // The ESP before the revision, both figures or neither (s72A(5)(b)(i); 9 Nov 2026).
    const before = f.previousEspLow != null && f.previousEspHigh != null;
    pending.previousLow = before ? Number(f.previousEspLow) : null;
    pending.previousHigh = before ? Number(f.previousEspHigh) : null;
    if (!both) {
      pending.readFailed =
        "The notice was read, but the new price couldn't be made out. If it's handwritten or the photo is unclear, type the figures from it.";
    }
  }

  const { data: row } = await supabase
    .from("property_items")
    .select("id, data, status")
    .eq("property_id", args.propertyId)
    .eq("item_key", "d3")
    .maybeSingle();
  const existing = row as { id: string; data: Record<string, unknown> | null; status: string } | null;
  // Only the draft changes. The latest revision's figures, its notice and the
  // card's status stay exactly as they were until the agent saves.
  if (existing) {
    const { error: writeError } = await supabase
      .from("property_items")
      .update({ data: { ...(existing.data ?? {}), espRevised: true, pending } })
      .eq("id", existing.id);
    if (writeError) return { error: "Couldn't keep the notice just now. Try again." };
  } else {
    const { error: writeError } = await supabase.from("property_items").insert({
      agency_id: args.agencyId,
      property_id: args.propertyId,
      item_key: "d3",
      status: "open",
      data: { espRevised: true, pending },
    });
    if (writeError) return { error: "Couldn't keep the notice just now. Try again." };
  }
  return { error };
}
