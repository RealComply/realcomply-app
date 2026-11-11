"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext, type ActionState } from "@/lib/actions/compliance";
import { noSalesInReport, withReportChoice } from "@/lib/documents/report-choice";

// "This is my report" on the ESP card (Master, 11 Nov 2026; see
// lib/documents/report-choice.ts). The file stays; the agent enters its sales
// by hand on the ESP reasoning card. Who said so and when is kept on the card.

const ESP_CARD = "a4";

export async function confirmMyReport(propertyId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const { data: row } = await supabase
    .from("property_items")
    .select("data, evidence_path")
    .eq("property_id", propertyId)
    .eq("item_key", ESP_CARD)
    .maybeSingle();
  const card = row as { data?: unknown; evidence_path?: string | null } | null;
  if (!card?.evidence_path) return { error: "There's no report on the ESP card to confirm." };
  // Only while the card is asking: a report whose sales were found, or one
  // still being read, has nothing to confirm.
  if (!noSalesInReport(card.data, card.evidence_path)) {
    return { error: "This report doesn't need confirming. Reload the page to see where it's up to." };
  }

  const { error } = await supabase
    .from("property_items")
    .update({
      data: withReportChoice(card.data, {
        path: card.evidence_path,
        choice: "my_report",
        by: user.id,
        byName: profile.full_name ?? profile.email,
        at: new Date().toISOString(),
      }),
    })
    .eq("property_id", propertyId)
    .eq("item_key", ESP_CARD)
    // Still the same file: a report replaced in the meantime is not this one.
    .eq("evidence_path", card.evidence_path);
  if (error) return { error: `That couldn't be saved just now (${error.message}). Try again.` };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
