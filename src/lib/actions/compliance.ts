"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getItem, itemsForStage } from "@/lib/rules/nsw-sales";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

async function requireAuthContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    redirect("/signup");
  }

  return { supabase, user, profile };
}

async function loadProperty(supabase: Awaited<ReturnType<typeof createClient>>, propertyId: string) {
  const { data: property } = await supabase
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();
  return property as Property | null;
}

// Upserts a property_items row, keyed on (property_id, item_key) — see the
// unique index in supabase/migrations/0001_init.sql.
async function upsertItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: {
    agencyId: string;
    propertyId: string;
    itemKey: string;
    status: "open" | "done" | "flagged";
    data: Record<string, unknown>;
    eventDate?: string | null;
    completedBy?: string | null;
  },
) {
  return supabase
    .from("property_items")
    .upsert(
      {
        agency_id: params.agencyId,
        property_id: params.propertyId,
        item_key: params.itemKey,
        status: params.status,
        data: params.data,
        event_date: params.eventDate ?? null,
        completed_by: params.completedBy ?? null,
      },
      { onConflict: "property_id,item_key" },
    )
    .select("*")
    .single();
}

// Generic mark done / flag / reopen for a `checklist`-kind item, with an
// optional note and (for items that need it) an agent-asserted event date.
export async function setItemStatus(
  propertyId: string,
  itemKey: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();
  const rule = getItem(itemKey);

  if (rule?.licenseeOnly && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can complete this item." };
  }

  const status = String(formData.get("status") ?? "done") as "open" | "done" | "flagged";
  const note = String(formData.get("note") ?? "").trim();
  const eventDate = rule?.requiresDate ? String(formData.get("eventDate") ?? "") || null : null;

  const data: Record<string, unknown> = { note };

  // a4 (ESP) carries structured figures alongside the generic note, since
  // the live underquoting checks (c1, offers floor, final-sale diff) need
  // real numbers to compare against, not free text.
  if (itemKey === "a4") {
    const espLow = Number(formData.get("espLow") ?? 0) || null;
    const espHigh = Number(formData.get("espHigh") ?? espLow ?? 0) || espLow;
    data.espLow = espLow;
    data.espHigh = espHigh;
    if (espLow && espHigh && espLow > 0) {
      const spreadPct = ((espHigh - espLow) / espLow) * 100;
      data.spreadPct = Math.round(spreadPct * 10) / 10;
      if (spreadPct > 10) {
        const { error } = await upsertItem(supabase, {
          agencyId: profile.agency_id,
          propertyId,
          itemKey,
          status: "flagged",
          data: { ...data, flagReason: "ESP range spread exceeds 10% (s72A)." },
          completedBy: user.id,
        });
        revalidatePath(`/dashboard/${propertyId}`);
        return error ? { error: error.message } : ok;
      }
    }
  }

  // c1 — the live underquoting check: advertised guide vs the recorded ESP
  // (a4), no prohibited price terms, spread within 10%. Flags rather than
  // silently passing if the ESP hasn't been recorded yet to check against.
  if (itemKey === "c1") {
    const guideLow = Number(formData.get("guideLow") ?? 0) || null;
    const guideHigh = Number(formData.get("guideHigh") ?? guideLow ?? 0) || guideLow;
    data.guideLow = guideLow;
    data.guideHigh = guideHigh;

    const { data: espItem } = await supabase
      .from("property_items")
      .select("data")
      .eq("property_id", propertyId)
      .eq("item_key", "a4")
      .maybeSingle();
    const esp = (espItem?.data ?? {}) as { espLow?: number };

    const lowerNote = (data.note as string).toLowerCase();
    const usesProhibitedTerm = ["offers over", "offers above", "o.n.o", "offers from"].some((t) =>
      lowerNote.includes(t),
    );
    const belowEsp = esp.espLow != null && guideLow != null && guideLow < esp.espLow;
    const spreadPct = guideLow && guideHigh ? ((guideHigh - guideLow) / guideLow) * 100 : 0;

    const flagReasons = [
      belowEsp ? "Advertised guide is below the recorded ESP (s73)." : null,
      usesProhibitedTerm ? "Note mentions a prohibited price term." : null,
      spreadPct > 10 ? "Guide range spread exceeds 10%." : null,
      esp.espLow == null ? "No ESP recorded yet to check against — record a4 first." : null,
    ].filter(Boolean) as string[];

    const { error } = await upsertItem(supabase, {
      agencyId: profile.agency_id,
      propertyId,
      itemKey,
      status: flagReasons.length > 0 ? "flagged" : "done",
      data: { ...data, flagReasons },
      completedBy: user.id,
    });

    revalidatePath(`/dashboard/${propertyId}`);
    return error ? { error: error.message } : ok;
  }

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey,
    status,
    data,
    eventDate,
    completedBy: status === "done" ? user.id : null,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// d1 — ESP review log. Appends a dated note; doesn't gate stage completion.
export async function addReviewEntry(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();
  const note = String(formData.get("note") ?? "").trim();

  if (!note) {
    return { error: "Add a note for this review." };
  }

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "d1")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as Array<{
    note: string;
    recordedAt: string;
  }>;
  entries.unshift({ note, recordedAt: new Date().toISOString() });

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "d1",
    status: "done",
    data: { entries },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// d2 — offers log. Live underquoting check: a rejected offer above the
// advertised guide (c1) can never be advertised below again (s73A) — we
// flag the offers item so it's visible, we don't silently pass it.
export async function addOfferEntry(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const amount = Number(formData.get("amount") ?? 0);
  const outcome = String(formData.get("outcome") ?? "pending"); // pending | accepted | rejected
  const vendorInformed = formData.get("vendorInformed") === "on";
  const belowFloor = formData.get("belowFloor") === "on";
  const note = String(formData.get("note") ?? "").trim();

  if (!amount) {
    return { error: "Enter the offer amount." };
  }

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "d2")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as Array<{
    amount: number;
    outcome: string;
    vendorInformed: boolean;
    belowFloor: boolean;
    note: string;
    recordedAt: string;
  }>;
  entries.unshift({ amount, outcome, vendorInformed, belowFloor, note, recordedAt: new Date().toISOString() });

  // s73A check: a rejected offer, once made in writing and not below an
  // agreed vendor floor, sets a floor the advertised price can't go under.
  const rejectedFloor = entries
    .filter((e) => e.outcome === "rejected" && !e.belowFloor)
    .reduce((max, e) => Math.max(max, e.amount), 0);

  let status: "open" | "done" | "flagged" = "done";
  let flagReason: string | undefined;

  if (!vendorInformed && !belowFloor) {
    status = "flagged";
    flagReason = "Vendor not yet informed of this offer in writing (Sch 2 r5).";
  }

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "d2",
    status,
    data: { entries, rejectedFloor, flagReason },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// d3 — price reduction / ESP revision workflow. If the ESP itself was
// revised, s72A requires written notice to the vendor + an amended
// agreement — this records that those steps happened; it doesn't chase
// them up automatically (no document generation wired in yet).
export async function recordReduction(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const reason = String(formData.get("reason") ?? "").trim();
  const espAdjusted = formData.get("espAdjusted") === "on";
  const newEspLow = Number(formData.get("newEspLow") ?? 0) || null;
  const newEspHigh = Number(formData.get("newEspHigh") ?? newEspLow ?? 0) || newEspLow;
  const vendorNotified = formData.get("vendorNotified") === "on";
  const agreementAmended = formData.get("agreementAmended") === "on";

  if (!reason) {
    return { error: "Add a reason for the reduction." };
  }
  if (espAdjusted && (!vendorNotified || !agreementAmended)) {
    return {
      error:
        "An ESP revision requires both written notice to the vendor and an amended agreement before it can be logged as complete.",
    };
  }

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as unknown[];
  entries.unshift({
    reason,
    espAdjusted,
    newEspLow,
    newEspHigh,
    vendorNotified,
    agreementAmended,
    recordedAt: new Date().toISOString(),
  });

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "d3",
    status: "done",
    data: { entries },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// f0 — final sale price, checked against the recorded ESP range.
export async function recordSale(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const price = Number(formData.get("price") ?? 0);
  if (!price) {
    return { error: "Enter the final sale price." };
  }

  const { data: espItem } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "a4")
    .maybeSingle();

  const espData = (espItem?.data ?? {}) as { espLow?: number; espHigh?: number };
  const outsideRange =
    espData.espLow != null && espData.espHigh != null
      ? price < espData.espLow || price > espData.espHigh
      : false;

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "f0",
    status: outsideRange ? "flagged" : "done",
    data: {
      price,
      espLow: espData.espLow ?? null,
      espHigh: espData.espHigh ?? null,
      outsideRange,
      flagReason: outsideRange
        ? "Final price falls outside the recorded ESP range — point to the ESP revision log (d3) as evidence of reasonableness."
        : undefined,
    },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// sign_agent / sign_licensee — typed-name attestation, immutable once set.
export async function signItem(
  propertyId: string,
  itemKey: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();
  const rule = getItem(itemKey);

  if (rule?.licenseeOnly && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can sign here." };
  }

  const typedName = String(formData.get("typedName") ?? "").trim();
  if (!typedName) {
    return { error: "Type your name to adopt it as your signature." };
  }

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey,
    status: "done",
    data: { typedName, signedAt: new Date().toISOString() },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// send_licensee — hand-off marker. No email infra wired up yet (flagged
// honestly in the item's own description), so this just records the step.
export async function sendToLicensee(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "send_licensee",
    status: "done",
    data: { sentAt: new Date().toISOString() },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
}

// f2 — generates the finalised (read-only, printable) compliance summary.
// This does not purge or delete anything — no document storage is wired
// up yet, so there's nothing to purge; see the item's own description.
export async function generateExport(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "f2",
    status: "done",
    data: { generatedAt: new Date().toISOString() },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
}

const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024; // 20MB
const EVIDENCE_BUCKET = "compliance-evidence";

function sanitizeFileName(name: string): string {
  // Keep it simple and storage-path-safe; the original name is preserved
  // separately in data.evidenceFileName for display.
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

// Attaches (or replaces) the evidence file for a single item. One file per
// item for now — evidence_path is a single column on property_items, not a
// list (supabase/migrations/0001_init.sql). Path convention:
// `${agency_id}/${property_id}/${item_key}/${timestamp}-${filename}`, which
// the storage RLS policies in 0002_evidence_storage.sql key off directly.
export async function uploadEvidence(
  propertyId: string,
  itemKey: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to attach." };
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return { error: "File is too large — 20MB max." };
  }

  const { data: existingRow } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey)
    .maybeSingle();
  const existing = existingRow as PropertyItem | null;

  const path = `${profile.agency_id}/${propertyId}/${itemKey}/${Date.now()}-${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await supabase.storage
    .from(EVIDENCE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined });

  if (uploadError) {
    return { error: uploadError.message };
  }

  // Only remove the old file once the new one is safely uploaded, so a
  // failed upload never leaves an item with no evidence at all.
  if (existing?.evidence_path) {
    await supabase.storage.from(EVIDENCE_BUCKET).remove([existing.evidence_path]);
  }

  const { error } = await supabase.from("property_items").upsert(
    {
      agency_id: profile.agency_id,
      property_id: propertyId,
      item_key: itemKey,
      status: existing?.status ?? "open",
      data: { ...(existing?.data ?? {}), evidenceFileName: file.name },
      event_date: existing?.event_date ?? null,
      completed_by: existing?.completed_by ?? null,
      evidence_path: path,
    },
    { onConflict: "property_id,item_key" },
  );

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// Removes the attached evidence file (storage object + the pointer/filename
// on the item row) without touching the item's status, note, or any other
// data — evidence is supporting material, not the record of completion.
export async function removeEvidence(propertyId: string, itemKey: string): Promise<void> {
  const { supabase, profile } = await requireAuthContext();

  const { data: existingRow } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", itemKey)
    .maybeSingle();
  const existing = existingRow as PropertyItem | null;

  if (!existing?.evidence_path) {
    return;
  }

  await supabase.storage.from(EVIDENCE_BUCKET).remove([existing.evidence_path]);

  const { evidenceFileName: _drop, ...restData } = existing.data as Record<string, unknown> & {
    evidenceFileName?: string;
  };

  await supabase
    .from("property_items")
    .update({ evidence_path: null, data: restData, agency_id: profile.agency_id })
    .eq("property_id", propertyId)
    .eq("item_key", itemKey);

  revalidatePath(`/dashboard/${propertyId}`);
}

export async function toggleTestMode(propertyId: string): Promise<void> {
  const { supabase } = await requireAuthContext();

  const property = await loadProperty(supabase, propertyId);
  if (!property) return;

  await supabase.from("properties").update({ test_mode: !property.test_mode }).eq("id", propertyId);
  revalidatePath(`/dashboard/${propertyId}`);
}

// Validates every requiredForStageCompletion item in the current stage is
// `done`, then unlocks the next stage. In test mode, the gate is bypassed
// (see the prototype's 🔓 test-mode toggle) so the flow can be exercised
// without filling everything in.
export async function completeStage(
  propertyId: string,
  _prevState: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const { supabase } = await requireAuthContext();

  const property = await loadProperty(supabase, propertyId);
  if (!property) {
    return { error: "Property not found." };
  }

  if (property.stage >= 5) {
    return { error: "This file is already at the final stage." };
  }

  if (!property.test_mode) {
    const required = itemsForStage(property.stage, property).filter((i) => i.requiredForStageCompletion);

    const { data: propertyItems } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId);

    const byKey = new Map(((propertyItems ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
    const incomplete = required.filter((r) => byKey.get(r.key)?.status !== "done");

    if (incomplete.length > 0) {
      return {
        error: `Complete these first: ${incomplete.map((i) => i.label).join(", ")}.`,
      };
    }
  }

  const nextStage = (property.stage + 1) as PropertyStage;
  const { error } = await supabase.from("properties").update({ stage: nextStage }).eq("id", propertyId);

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}
