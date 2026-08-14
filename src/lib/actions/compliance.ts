"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getItem, itemsForStage } from "@/lib/rules/nsw-sales";
import { finalizeEvidenceRecord, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type { Property, PropertyItem, PropertyStage } from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

export async function requireAuthContext() {
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

  // a7 (material facts) carries a structured yes/no alongside the generic
  // note — e2 (Stage 4) reads this to decide whether "disclosed to the
  // purchaser" even applies to this file, so it needs a real boolean, not
  // something inferred from free text.
  if (itemKey === "a7") {
    data.materialFactDisclosed = String(formData.get("materialFactDisclosed") ?? "") === "yes";
  }

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

// f3 — pre-purchase inspection report register (cl 37, Property and Stock
// Agents Regulation 2022). The agent just uploads the report; every cl 37
// field here comes from extractReportDetails (see ItemCard.tsx's
// ReportsLogItem), not manual entry — this action just records what was
// found and, separately, what wasn't (missingFields), so a partial document
// still produces a useful, honest record rather than blocking the agent or
// silently pretending a gap doesn't exist. Never blocks stage completion —
// an empty register (no reports the licensee is aware of) is a valid,
// normal outcome, and neither is a genuinely required field to log an entry
// at all: the agent may only have a note about a report, not the document.
export async function addReportEntry(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const pestInspection = formData.get("pestInspection") === "true";
  const buildingInspection = formData.get("buildingInspection") === "true";
  const strata = formData.get("strata") === "true";
  const inspectionDate = String(formData.get("inspectionDate") ?? "").trim();
  const preparerName = String(formData.get("preparerName") ?? "").trim();
  const preparerContact = String(formData.get("preparerContact") ?? "").trim();
  const preparerInsured = formData.get("preparerInsured") === "true";
  const availableForRepurchase = formData.get("availableForRepurchase") === "true";
  const note = String(formData.get("note") ?? "").trim();
  const evidencePath = String(formData.get("evidencePath") ?? "").trim() || null;
  const evidenceFileName = String(formData.get("evidenceFileName") ?? "").trim() || null;

  if (!evidencePath && !note) {
    return { error: "Attach the report, or add a note describing it, before logging an entry." };
  }

  const missingFields: string[] = [];
  if (!inspectionDate) missingFields.push("inspection date");
  if (!preparerName) missingFields.push("preparer's name");
  if (!preparerContact) missingFields.push("preparer's business address/phone");
  if (!preparerInsured) missingFields.push("whether the preparer holds PI insurance");
  if (!availableForRepurchase) missingFields.push("whether it's available for repurchase");

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "f3")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as Array<{
    pestInspection: boolean;
    buildingInspection: boolean;
    strata: boolean;
    inspectionDate: string;
    preparerName: string;
    preparerContact: string;
    preparerInsured: boolean;
    availableForRepurchase: boolean;
    note: string;
    evidencePath: string | null;
    evidenceFileName: string | null;
    missingFields: string[];
    recordedAt: string;
  }>;
  entries.unshift({
    pestInspection,
    buildingInspection,
    strata,
    inspectionDate,
    preparerName,
    preparerContact,
    preparerInsured,
    availableForRepurchase,
    note,
    evidencePath,
    evidenceFileName,
    missingFields,
    recordedAt: new Date().toISOString(),
  });

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "f3",
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

// d3 — price reduction / ESP revision, simplified (12 Aug 2026) to a plain
// Yes/No question: did the ESP need to be revised this campaign? The old
// version asked for a typed reason plus separate figures/checkboxes
// (vendor-notified, agreement-amended) re-typed by hand — Adam flagged that
// as unnecessary duplication. The written notice sent to the vendor IS the
// record now; it's attached via the item's own generic evidence uploader
// (ItemShell, since d3 doesn't hideEvidence), not retyped into this form.
export async function markEspRevised(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "d3",
    status: "done",
    data: { espRevised: true },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
}

// d3 — "no revision" outcome. Most listings never need an ESP change, so
// this marks the item done immediately without asking for evidence.
export async function markNoPriceRevision(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "d3",
    status: "done",
    data: { espRevised: false },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
}

// b5 — verbal price-quote log. Logging an entry here IS the written record
// the Price Reps checklist requires for a verbal price statement — there's
// no separate "confirm it was written down" step because this is that step.
export async function addVerbalQuoteEntry(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const amount = Number(formData.get("amount") ?? 0);
  const context = String(formData.get("context") ?? "").trim();

  if (!amount) {
    return { error: "Enter the figure that was quoted." };
  }
  if (!context) {
    return { error: "Note who it was given to / the context (e.g. \"buyer at Saturday's open home\")." };
  }

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "b5")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as unknown[];
  entries.unshift({ amount, context, recordedAt: new Date().toISOString() });

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "b5",
    status: "done",
    data: { entries },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// b5 — "nothing to log yet" fast path, same shape as markNoPriceRevision.
// Most files won't have a verbal quote to log before Pre-market completes —
// this lets the gate clear without forcing an empty log entry, while
// staying happy to be reopened and added to later in the campaign.
export async function markNoVerbalQuotes(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "b5")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as unknown[];

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "b5",
    status: "done",
    data: { entries, noQuotes: true },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
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

// Attaches (or replaces) the evidence file for a single item. One file per
// item for now — evidence_path is a single column on property_items, not a
// list (supabase/migrations/0001_init.sql). The actual upload/attach logic
// is shared with the property-setup upload fields (agency agreement,
// contract for sale, comparable-sales report) via src/lib/storage/evidence.ts.
// The browser uploads the file straight to Storage itself (see
// EvidenceUploader in ItemCard.tsx and src/lib/storage/evidence.ts for why
// — a Server Action can't reliably carry a real multi-MB document, since
// Vercel Functions hard-cap request bodies at 4.5MB regardless of app
// config). This action only ever receives the resulting path + filename as
// plain strings and records the pointer.
export async function uploadEvidence(
  propertyId: string,
  itemKey: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, profile } = await requireAuthContext();

  const path = String(formData.get("path") ?? "").trim();
  const fileName = String(formData.get("fileName") ?? "").trim();
  if (!path || !fileName) {
    return { error: "Choose a file to attach." };
  }

  const { error } = await finalizeEvidenceRecord(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey,
    path,
    fileName,
  });

  if (error) {
    revalidatePath(`/dashboard/${propertyId}`);
    return { error };
  }

  // Read the document straight away rather than waiting for someone to press
  // "Extract from uploaded documents" at the top of the page (Adam, 14 Aug
  // 2026). He attached a comparable-sales report and reasonably expected the
  // findings to reflect it; nothing re-read the file, so the card kept saying
  // no comparables were present. No-ops unless the file landed on one of the
  // three items the AI reads.
  //
  // A failure here is deliberately not surfaced as an upload error: the file
  // did attach, which is the thing the agent asked for, and the page-level
  // button remains as the retry. Reporting "upload failed" over a successful
  // upload would be worse than a stale finding.
  // Imported at call time, not at the top of the file: extraction.ts imports
  // requireAuthContext from this module, so a static import here would close a
  // cycle between the two.
  const { extractForAttachment } = await import("@/lib/actions/extraction");
  const extraction = await extractForAttachment(propertyId, itemKey);
  if (extraction.error) {
    console.error("post-attach extraction failed:", itemKey, extraction.error);
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return ok;
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
    const { data: propertyItems } = await supabase
      .from("property_items")
      .select("*")
      .eq("property_id", propertyId);

    const byKey = new Map(((propertyItems ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
    // Built before itemsForStage so conditional items (e.g. e2, which only
    // appears once a7 records a disclosed material fact) see the same
    // recorded data the page itself would show.
    const allItems = Object.fromEntries(byKey);
    const required = itemsForStage(property.stage, property, allItems).filter((i) => i.requiredForStageCompletion);
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
