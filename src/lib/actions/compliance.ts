"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getItem, itemsForStage } from "@/lib/rules/nsw-sales";
import { AML_COMMENCEMENT_DATE, preCommencementNote } from "@/lib/rules/aml-precommencement";
import { finalizeEvidenceRecord, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import type {
  AuctionOutcomeData,
  AuctionOutcomeKind,
  Property,
  PropertyItem,
  PropertyStage,
} from "@/lib/types";

export type ActionState = { error: string | null };
const ok: ActionState = { error: null };

// The one line an assistant cannot cross (Adam, 20 Aug 2026): they prepare
// the whole file, they do not sign it. Both signature items and every
// licensee-only item are theirs to see and to chase, never to complete.
//
// Enforced here on the server, not just by disabling a button — the buttons
// are a courtesy, this is the rule. RLS cannot do it because it governs rows,
// and which compliance item a row represents is a value in a column.
const ASSISTANT_BLOCKED_ITEMS = new Set(["sign_agent", "sign_licensee"]);

function assistantBlocked(itemKey: string, profile: { is_assistant?: boolean }): boolean {
  if (!profile.is_assistant) return false;
  return ASSISTANT_BLOCKED_ITEMS.has(itemKey) || Boolean(getItem(itemKey)?.licenseeOnly);
}

const ASSISTANT_BLOCKED_MESSAGE =
  "Assistants can prepare a file but not sign it. Hand it to the agent to review and sign.";

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

  if (assistantBlocked(itemKey, profile)) {
    return { error: ASSISTANT_BLOCKED_MESSAGE };
  }

  if (rule?.licenseeOnly && !profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can complete this item." };
  }

  const status = String(formData.get("status") ?? "done") as "open" | "done" | "flagged";
  const note = String(formData.get("note") ?? "").trim();
  const eventDate = rule?.requiresDate ? String(formData.get("eventDate") ?? "") || null : null;

  // A required date was collected but never actually required: you could mark
  // one of these done with the field empty and the item would close and pass
  // the stage gate (Adam, 14 Aug 2026, on a2). That matters because on every
  // item carrying requiresDate the date IS the obligation, not a detail beside
  // it — s56 turns on the guide being given before signing and within a month
  // of it, s55/Sch 1 r16 on service within 48 hours, Sch 2 r17 on service
  // within 2 business days. An item marked done with no date records that
  // something happened while omitting the only fact that shows it happened in
  // time.
  //
  // Only blocks "done". Reopening or flagging an item you have no date for has
  // to stay possible, or a mistake becomes unfixable.
  if (status === "done" && rule?.requiresDate && !eventDate) {
    return { error: "Enter the date this happened before marking it done." };
  }

  // Same reasoning as the date above, for items where the NOTE is the record.
  // b4 (licensee approved the price statement) is the case: a tick on its own
  // asserts that something was approved while preserving nothing about what it
  // said, so a later challenge to the advertised guide finds an approval of an
  // unknown figure. Only blocks "done", for the same reason — flagging or
  // reopening must stay possible.
  if (status === "done" && rule?.requiresNote && !note) {
    return {
      error: rule.noteLabel
        ? `Type in ${rule.noteLabel.toLowerCase()} before marking it done.`
        : "Add a note before marking this done.",
    };
  }

  const data: Record<string, unknown> = { note };

  // amv — closing the vendor AML item by pre-commencement rather than by CDD.
  //
  // Re-checked here from scratch and never taken on the browser's word. The
  // form only says "the agent pressed the pre-commencement button"; whether
  // that is allowed depends on two facts the server owns — the agency has
  // taken the position, and the agreement on this file actually predates
  // commencement. A hand-rolled POST must not be able to close an AML item.
  //
  // The note is overwritten rather than appended to. This item's note is the
  // reason the item is closed, and "no initial CDD, here is why" has to be the
  // whole of it — a stale sentence about a PEXA reference sitting above it
  // would read as though CDD was done after all.
  if (itemKey === "amv" && String(formData.get("preCommencement") ?? "") === "yes") {
    const { data: agency } = await supabase
      .from("agencies")
      .select("aml_precommencement_enabled")
      .eq("id", profile.agency_id)
      .maybeSingle();

    if (!agency?.aml_precommencement_enabled) {
      return {
        error:
          "Your agency has not turned on the pre-commencement position. The licensee in charge can enable it in Registers.",
      };
    }

    const { data: agreementRow } = await supabase
      .from("property_items")
      .select("event_date")
      .eq("property_id", propertyId)
      .eq("item_key", "a3")
      .maybeSingle();

    const signed = (agreementRow as { event_date?: string | null } | null)?.event_date ?? null;

    if (!signed) {
      return {
        error:
          "Record the agency agreement date first — pre-commencement depends on when the agreement was signed.",
      };
    }
    if (signed >= AML_COMMENCEMENT_DATE) {
      return {
        error: `This agreement was signed ${signed}, on or after ${AML_COMMENCEMENT_DATE}. CDD is required.`,
      };
    }

    const { error: preError } = await upsertItem(supabase, {
      agencyId: profile.agency_id,
      propertyId,
      itemKey,
      status: "done",
      data: {
        note: preCommencementNote(signed),
        preCommencement: true,
        preCommencementAgreementDate: signed,
        preCommencementRecordedBy: user.id,
      },
      completedBy: user.id,
    });

    revalidatePath(`/dashboard/${propertyId}`);
    return preError ? { error: preError.message } : ok;
  }

  // a7 (material facts) carries a structured yes/no alongside the generic
  // note — e2 (Stage 4) reads this to decide whether "disclosed to the
  // purchaser" even applies to this file, so it needs a real boolean, not
  // something inferred from free text.
  if (itemKey === "a7") {
    const answer = String(formData.get("materialFactDisclosed") ?? "");

    // An unanswered dropdown used to fall through to `=== "yes"` and save
    // FALSE — so an agent who never touched the control, and hit Save, silently
    // recorded "none disclosed" on the vendor's behalf. That is a compliance
    // record nobody made, and it does not just sit there: e2 (disclose the
    // material fact to the purchaser) only appears when this is true, so a
    // phantom "no" removes a later obligation from the file without anyone
    // seeing it happen.
    //
    // Same shape as the requiresDate guard above — only "done" is blocked, so
    // reopening or flagging still works when you have no answer yet.
    if (status === "done" && answer !== "yes" && answer !== "no") {
      return { error: "Choose whether the vendor disclosed a material fact before marking this done." };
    }
    if (answer === "yes" || answer === "no") {
      data.materialFactDisclosed = answer === "yes";
    }
  }

  // Set by the a4 branch below, acted on after the save succeeds.
  let espChanged = false;

  // a4 (ESP) carries structured figures alongside the generic note, since
  // the live underquoting checks (c1, offers floor, final-sale diff) need
  // real numbers to compare against, not free text.
  if (itemKey === "a4") {
    const espLow = Number(formData.get("espLow") ?? 0) || null;
    const espHigh = Number(formData.get("espHigh") ?? espLow ?? 0) || espLow;

    // Whether this save actually changes the figures, decided before they are
    // written. A revised ESP is the moment s73(3) starts running — "as soon as
    // practicable ... amend or retract any advertisement" showing less than the
    // revised figure — so the live ad is re-read now rather than waiting for
    // Sunday's sweep (Adam, 16 Aug 2026).
    const { data: previousRow } = await supabase
      .from("property_items")
      .select("data")
      .eq("property_id", propertyId)
      .eq("item_key", "a4")
      .maybeSingle();
    const previous = ((previousRow as { data?: { espLow?: number; espHigh?: number } } | null)?.data ?? {}) as {
      espLow?: number;
      espHigh?: number;
    };
    espChanged =
      (previous.espLow ?? null) !== espLow || (previous.espHigh ?? null) !== espHigh;

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
        await recheckAdvertisedPrice(propertyId, espChanged);
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

  if (!error && itemKey === "a4") {
    await recheckAdvertisedPrice(propertyId, espChanged);
  }

  if (!error && itemKey === "a3") {
    await revokePreCommencementIfAgreementIsNew(supabase, propertyId, eventDate);
  }

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

  // Adam, 18 Aug 2026: "I only wanna have a manual entry of those details if
  // the agent can't provide a copy of the report." So a copy is the expected
  // path and is enough on its own — the details get read off it. Where there
  // is no copy, the two things cl 37 turns on (what kind of report, and when
  // it was done) have to be typed, because a register entry that records
  // neither is not a register entry.
  const typedByHand = pestInspection || buildingInspection || strata;
  if (!evidencePath && !(typedByHand && inspectionDate)) {
    return {
      error: "Attach the report, or if you don't have a copy, say what kind of report it was and when it was done.",
    };
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

// d2 — offers log.
//
// Entries carry an id so they can be edited later (Adam, 17 Aug 2026: "we need
// the ability to re-open and edit an offer"). Addressed by id rather than by
// position because entries are unshifted onto the front of the array, so every
// index shifts when a new offer is logged — and an off-by-one edit on a legal
// record is the kind of bug you only notice in a dispute.
export type OfferEntry = {
  id: string;
  amount: number;
  outcome: string;
  vendorInformed: boolean;
  belowFloor: boolean;
  note: string;
  recordedAt: string;
  /** Set the first time an entry is edited. The original recordedAt is kept. */
  updatedAt?: string;
};

/** Backfills ids onto entries written before ids existed. */
function withIds(entries: OfferEntry[]): OfferEntry[] {
  return entries.map((e) => (e.id ? e : { ...e, id: crypto.randomUUID() }));
}

/**
 * Everything the offers item derives from its entries, computed in one place
 * so adding an offer and editing one can never disagree.
 *
 * Recomputed across the WHOLE list every time rather than only for the entry
 * being touched. That is the point of making entries editable: changing an
 * outcome from pending to rejected has to be able to raise the ESP prompt, and
 * correcting an amount downwards has to be able to withdraw it.
 */
function assessOffers(entries: OfferEntry[], threshold: number | null, thresholdSource: string) {
  // s73A safeguard already in place: a rejected offer, in writing and not
  // below an agreed vendor floor, sets a floor the advertised price can't go
  // under.
  const rejectedFloor = entries
    .filter((e) => e.outcome === "rejected" && !e.belowFloor)
    .reduce((max, e) => Math.max(max, e.amount), 0);

  const unreported = entries.find((e) => !e.vendorInformed && !e.belowFloor);
  const status: "open" | "done" | "flagged" = unreported ? "flagged" : "done";
  const flagReason = unreported
    ? "An offer here has not yet been put to the vendor in writing (Sch 2 r5)."
    : undefined;

  // Rejected at or above the advertised price → the estimate is stale.
  //
  // Adam, 17 Aug 2026. If a buyer offers inside the advertised range, at the
  // advertised single figure, or above it, and the vendor rejects it, the
  // property demonstrably will not sell at the bottom of what is being
  // advertised. Continuing to advertise from that figure is quoting a price
  // the vendor has already refused.
  //
  // THE CITATION IS NOT s73A. s73A(1) prohibits a statement suggesting a
  // property may sell for less than THE ESTIMATED SELLING PRICE — it says
  // nothing about rejected offers. The rejected-offer rule is part of the
  // announced NSW reforms and has not commenced; citing it as current law
  // would be inventing an obligation.
  //
  // The real, current duty is s72A(3): the ESP must "be, and remain" a
  // reasonable estimate. A rejection at or above the advertised figure is
  // direct market evidence that it no longer is — and it is stale UPWARDS,
  // the estimate being too low rather than too high. s72A(4) then governs how
  // a revision is made, s72A(5) the evidence, s73(3) the advertising deadline.
  //
  // Reports only. Never revises the ESP, never touches a4.
  const highestRejectedAtOrAbove =
    threshold != null && threshold > 0
      ? entries
          .filter((e) => e.outcome === "rejected" && e.amount >= threshold)
          .reduce((max, e) => Math.max(max, e.amount), 0)
      : 0;

  const espRevisionPrompt =
    highestRejectedAtOrAbove > 0 && threshold != null
      ? `An offer of $${highestRejectedAtOrAbove.toLocaleString()} was at or above your ${thresholdSource} of ` +
        `$${threshold.toLocaleString()} and was rejected. The estimated selling price may no longer be a ` +
        `reasonable estimate (s72A(3)). If you revise it, the vendor must be notified in writing and the ` +
        `agency agreement amended (s72A(4)), and any advertising below the revised figure amended or ` +
        `retracted as soon as practicable (s73(3)).`
      : undefined;

  return { rejectedFloor, status, flagReason, espRevisionPrompt };
}

/** The figure a rejected offer is measured against: what is advertised if
 *  anything is, otherwise the recorded ESP. */
async function offerThreshold(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
): Promise<{ threshold: number | null; source: string }> {
  const [{ data: guideRow }, { data: espRow }] = await Promise.all([
    supabase.from("property_items").select("data").eq("property_id", propertyId).eq("item_key", "c1").maybeSingle(),
    supabase.from("property_items").select("data").eq("property_id", propertyId).eq("item_key", "a4").maybeSingle(),
  ]);
  const guideLow = (guideRow?.data as { guideLow?: number } | null)?.guideLow ?? null;
  const espLow = (espRow?.data as { espLow?: number } | null)?.espLow ?? null;
  return {
    threshold: guideLow ?? espLow,
    source: guideLow != null ? "advertised price" : "recorded ESP",
  };
}

async function readOffers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
): Promise<OfferEntry[]> {
  const { data } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "d2")
    .maybeSingle();
  return withIds(((data?.data as { entries?: OfferEntry[] } | null)?.entries ?? []) as OfferEntry[]);
}

async function saveOffers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { agencyId: string; propertyId: string; userId: string; entries: OfferEntry[] },
): Promise<ActionState> {
  const { threshold, source } = await offerThreshold(supabase, params.propertyId);
  const assessment = assessOffers(params.entries, threshold, source);

  const { error } = await upsertItem(supabase, {
    agencyId: params.agencyId,
    propertyId: params.propertyId,
    itemKey: "d2",
    status: assessment.status,
    data: {
      entries: params.entries,
      rejectedFloor: assessment.rejectedFloor,
      flagReason: assessment.flagReason,
      espRevisionPrompt: assessment.espRevisionPrompt,
    },
    completedBy: params.userId,
  });

  if (!error && assessment.espRevisionPrompt) {
    await reopenStaleNoRevision(supabase, params.propertyId, assessment.espRevisionPrompt);
  }

  revalidatePath(`/dashboard/${params.propertyId}`);
  return error ? { error: error.message } : ok;
}

function offerFromForm(formData: FormData) {
  return {
    amount: Number(formData.get("amount") ?? 0),
    outcome: String(formData.get("outcome") ?? "pending"),
    vendorInformed: formData.get("vendorInformed") === "on",
    belowFloor: formData.get("belowFloor") === "on",
    note: String(formData.get("note") ?? "").trim(),
  };
}

export async function addOfferEntry(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const fields = offerFromForm(formData);
  if (!fields.amount) return { error: "Enter the offer amount." };

  const entries = await readOffers(supabase, propertyId);
  entries.unshift({ id: crypto.randomUUID(), ...fields, recordedAt: new Date().toISOString() });

  return saveOffers(supabase, { agencyId: profile.agency_id, propertyId, userId: user.id, entries });
}

/**
 * Edits an offer already in the log.
 *
 * An offer is not a one-shot event — it starts pending, becomes accepted or
 * rejected, and amounts get mistyped. Without this the agent's only options
 * were to log a duplicate or leave the record wrong, and a duplicate offer in
 * a compliance log is worse than either.
 *
 * The original recordedAt survives and updatedAt is stamped, so the log shows
 * an entry was revised rather than quietly presenting the new version as
 * though it had always said that. This is a record a regulator may read.
 */
export async function updateOfferEntry(
  propertyId: string,
  entryId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const fields = offerFromForm(formData);
  if (!fields.amount) return { error: "Enter the offer amount." };

  const entries = await readOffers(supabase, propertyId);
  // Matches on the id, or on recordedAt for entries logged before ids existed.
  // recordedAt is an ISO timestamp stamped at insert, so it is already unique
  // per entry and needs no backfill to be usable as a handle. Without this,
  // an offer logged before 17 Aug 2026 could not be edited until an unrelated
  // new offer was logged, which is a silly thing to ask of anyone.
  const index = entries.findIndex((e) => e.id === entryId || e.recordedAt === entryId);
  if (index === -1) return { error: "Couldn't find that offer — reload the page and try again." };

  entries[index] = { ...entries[index], ...fields, updatedAt: new Date().toISOString() };

  return saveOffers(supabase, { agencyId: profile.agency_id, propertyId, userId: user.id, entries });
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

/**
 * f3 — the "no reports" answer.
 *
 * cl 37 requires a register of the reports the agent is AWARE of, and on most
 * sales there are none. Without a way to say so, the item sits open forever
 * and the agent cannot tell "nobody has looked" from "there is nothing to
 * log" — which is the same failure the consumer-guide item had.
 *
 * Reversible on purpose. A report can turn up at any point in a campaign, and
 * the card keeps a "Change answer" control so a later report can still be
 * logged against a file already answered "no".
 */
export async function markNoReports(propertyId: string): Promise<void> {
  const { supabase, user, profile } = await requireAuthContext();

  const { data: existing } = await supabase
    .from("property_items")
    .select("data")
    .eq("property_id", propertyId)
    .eq("item_key", "f3")
    .maybeSingle();

  const entries = ((existing?.data as { entries?: unknown[] } | null)?.entries ?? []) as unknown[];

  await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "f3",
    status: "done",
    data: { entries, noReports: true },
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

// ── Auction ─────────────────────────────────────────────────────────────────

// x1 — who is calling the auction. Typed rather than read off the bidders
// record (Adam, 18 Aug 2026): a bidders record is a list of bidders and there
// is no guarantee the auctioneer's own particulars are on it, while reg cl 16
// makes holding those particulars the selling licensee's own obligation. An
// obligation that is ours cannot depend on what happens to be printed on
// someone else's form.
export async function setAuctioneerDetails(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const name = String(formData.get("auctioneerName") ?? "").trim();
  const licenceNumber = String(formData.get("auctioneerLicence") ?? "").trim();
  const businessAddress = String(formData.get("auctioneerAddress") ?? "").trim();

  if (!name) return { error: "Enter the auctioneer's name." };
  if (!licenceNumber) return { error: "Enter the auctioneer's licence number." };

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "x1",
    status: "done",
    data: { name, licenceNumber, businessAddress: businessAddress || null },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// x4 — the reserve. The amount is kept as a number because x9 compares it
// against the outcome; the time is kept as the agent typed it because nothing
// computes on it.
export async function setReserve(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const reserve = Number(String(formData.get("reserve") ?? "").replace(/[^0-9.]/g, ""));
  const givenAt = String(formData.get("givenAt") ?? "").trim();

  if (!reserve) return { error: "Enter the reserve you gave the auctioneer." };

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "x4",
    status: "done",
    data: { reserve, givenAt: givenAt || null },
    completedBy: user.id,
  });

  revalidatePath(`/dashboard/${propertyId}`);
  return error ? { error: error.message } : ok;
}

// x8 — the outcome. The compliance payload of the whole module, and the input
// to the pricing logic: a passed-in bid from a registered bidder is the same
// signal as a rejected offer, which the product already knows how to handle.
//
// NOTE: this deliberately does NOT flip sale_method back to private treaty on
// a pass-in. The campaign WAS an auction and that is a fact about the file;
// flipping it would hide every auction item and the evidence attached to them
// at the exact moment the file most needs to show its working. Converting a
// passed-in campaign to a private treaty sale is a separate piece of work.
export async function recordAuctionOutcome(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { supabase, user, profile } = await requireAuthContext();

  const outcome = String(formData.get("outcome") ?? "") as AuctionOutcomeKind;
  if (!["sold", "passed_in", "withdrawn"].includes(outcome)) {
    return { error: "Choose what happened at the auction." };
  }

  const money = (field: string): number | null => {
    const raw = String(formData.get(field) ?? "").replace(/[^0-9.]/g, "");
    const n = Number(raw);
    return raw && Number.isFinite(n) && n > 0 ? n : null;
  };

  const phoneBidder = formData.get("phoneBidder") === "on";
  const data: AuctionOutcomeData = { outcome, phoneBidder };

  if (outcome === "sold") {
    const price = money("price");
    if (!price) return { error: "Enter the sale price." };
    data.price = price;
    data.bidderNumber = String(formData.get("bidderNumber") ?? "").trim() || null;
  } else if (outcome === "passed_in") {
    // A pass-in with no bid at all is entirely normal — the property was
    // offered and nobody bid. Not an error, and not a missing field.
    data.highestBid = money("highestBid");
    data.bidderNumber = String(formData.get("bidderNumber") ?? "").trim() || null;
    data.vendorBid = formData.get("vendorBid") === "on";
  } else {
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return { error: "Record why the property was withdrawn." };
    data.reason = reason;
  }

  const { error } = await upsertItem(supabase, {
    agencyId: profile.agency_id,
    propertyId,
    itemKey: "x8",
    status: "done",
    data: data as Record<string, unknown>,
    completedBy: user.id,
  });

  if (error) return { error: error.message };

  // A passed-in bid made by a registered bidder is evidence a real buyer sat
  // at that number, which is the same reasoning that reopens the ESP revision
  // item when an offer at or above the guide is rejected. A vendor bid is not
  // a buyer and must not trigger it.
  if (outcome === "passed_in" && data.highestBid && !data.vendorBid) {
    await reopenEspRevisionForAuction(supabase, propertyId, data.highestBid);
  }

  revalidatePath(`/dashboard/${propertyId}`);
  return ok;
}

// Reopens d3 (price reduction / ESP revision) off a passed-in bid. Kept
// separate and narrow: it only ever reopens, never closes, and it writes the
// reason in so the agent can see why the item came back.
async function reopenEspRevisionForAuction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  highestBid: number,
) {
  const { data: existing } = await supabase
    .from("property_items")
    .select("*")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();

  const current = (existing?.data ?? {}) as Record<string, unknown>;
  const { data: agencyProperty } = await supabase
    .from("properties")
    .select("agency_id")
    .eq("id", propertyId)
    .maybeSingle();

  if (!agencyProperty) return;

  await upsertItem(supabase, {
    agencyId: agencyProperty.agency_id as string,
    propertyId,
    itemKey: "d3",
    status: "open",
    data: {
      ...current,
      auctionPassInPrompt: {
        highestBid,
        raisedAt: new Date().toISOString(),
      },
    },
  });
}

// The assistant's hand-over. Deliberately NOT a sign-off.
//
// It records that the assistant finished their part and asked the agent to
// look. It attests nothing about the file being compliant — the only thing
// that says that is the agent's signature, and an assistant cannot make one
// (see assistantBlocked above). Keeping those two things apart is the whole
// legal point of the role, so this writes to the property rather than
// creating a completed compliance item that could be mistaken for one.
//
// It does not lock the file either. Work carries on while the agent reviews —
// an offer does not wait — and the agent can hand it back.
export async function requestAgentReview(propertyId: string): Promise<void> {
  const { supabase, user } = await requireAuthContext();

  await supabase
    .from("properties")
    .update({ review_requested_at: new Date().toISOString(), review_requested_by: user.id })
    .eq("id", propertyId);

  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/home");
}

// The agent sending it back, or clearing it once they have signed.
export async function clearAgentReview(propertyId: string): Promise<void> {
  const { supabase } = await requireAuthContext();

  await supabase
    .from("properties")
    .update({ review_requested_at: null, review_requested_by: null })
    .eq("id", propertyId);

  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/home");
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

  if (assistantBlocked(itemKey, profile)) {
    return { error: ASSISTANT_BLOCKED_MESSAGE };
  }

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

  // The agent signing is the answer to the assistant's hand-over, so the
  // request clears itself. Otherwise the file would sit in the agent's
  // "waiting for you" queue after they had already dealt with it.
  if (!error && itemKey === "sign_agent") {
    await supabase
      .from("properties")
      .update({ review_requested_at: null, review_requested_by: null })
      .eq("id", propertyId);
    revalidatePath("/dashboard/home");
  }

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

  // Refuse copies of personal ID before anything is recorded.
  //
  // Adam, 20 Aug 2026: "if the AI can detect any ID documents, then it rejects
  // them, and tells the agent that copies of identifiable documentation are
  // not to be uploaded into RealComply."
  //
  // The file is ALREADY in the bucket by the time we get here — the browser
  // uploads straight to Storage because Vercel caps request bodies at 4.5MB
  // (see NewPropertyForm.tsx). So this cannot prevent the object existing; it
  // deletes it, and never records it against the item. A licence therefore
  // touches storage for a few seconds rather than being kept. Removing that
  // window entirely would mean routing uploads through the server, which the
  // 4.5MB cap rules out — noted rather than hidden.
  if (getItem(itemKey)?.rejectIdDocuments) {
    const { screenForIdDocument } = await import("@/lib/actions/extraction");
    const looksLike = await screenForIdDocument(supabase, path, fileName);
    if (looksLike) {
      await supabase.storage.from(EVIDENCE_BUCKET).remove([path]);
      return {
        error:
          `That looks like ${looksLike}, so it hasn't been attached and has been deleted. ` +
          "RealComply doesn't keep the documents used to prove someone's identity, address or ownership — " +
          "licences, passports, rates notices, title searches and the like. Attach the verification record " +
          "instead: the VOI certificate or the signing audit trail, which shows the check was done without " +
          "reproducing what was checked.",
      };
    }
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

/**
 * Re-reads the live ad after the ESP changes.
 *
 * The weekly sweep already compares against whatever the ESP is at the time it
 * runs, so the figures were never stale. What was missing is the timing: an ESP
 * revised on Tuesday would not be checked against the advertising until Sunday,
 * and s73(3) requires the advertisement to be amended "as soon as practicable"
 * after a revision. A week is not that (Adam, 16 Aug 2026).
 *
 * Deferred import, same reason as extractForAttachment above: website-scan
 * imports requireAuthContext from this file, and a static import here would
 * close the circle.
 *
 * Never surfaces an error. This runs as a side effect of the agent saving a
 * figure; a website that is slow or down must not turn a successful save into a
 * failed one. If it does not run, Sunday catches it.
 */
/**
 * Reopens the vendor AML item when the agreement stops predating commencement.
 *
 * The pre-commencement exemption attaches to the relationship that existed on
 * 1 July 2026, and that relationship ends when the agreement does. A renewal,
 * an extension or a fresh agreement signed on or after that date is a new
 * designated service, and the vendor needs CDD like anyone else.
 *
 * In the file that shows up as the a3 date moving forward. When it does, an
 * amv closed on the old basis is now closed on a reason that is no longer
 * true, and leaving it green would hide a live AML obligation behind a tick
 * nobody would think to look at again.
 *
 * Only ever touches an item that was closed BY the pre-commencement route —
 * a real CDD record is untouched, because re-signing an agreement does not
 * undo due diligence that was actually performed.
 *
 * Reopened rather than flagged. Nothing has gone wrong; a thing that was not
 * required has become required, which is an open item, not a breach.
 */
async function revokePreCommencementIfAgreementIsNew(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  agreementDate: string | null,
): Promise<void> {
  if (!agreementDate || agreementDate < AML_COMMENCEMENT_DATE) return;

  const { data: row } = await supabase
    .from("property_items")
    .select("id, data")
    .eq("property_id", propertyId)
    .eq("item_key", "amv")
    .maybeSingle();

  const existing = (row as { id?: string; data?: { preCommencement?: boolean } } | null) ?? null;
  if (!existing?.id || existing.data?.preCommencement !== true) return;

  await supabase
    .from("property_items")
    .update({
      status: "open",
      completed_by: null,
      data: {
        note: `Reopened automatically. The agency agreement is now dated ${agreementDate}, on or after ${AML_COMMENCEMENT_DATE}, so the pre-commencement basis no longer applies and customer due diligence is required for the vendor.`,
        preCommencement: false,
        preCommencementRevokedOn: agreementDate,
      },
    })
    .eq("id", existing.id);
}

/**
 * Reopens d3 where it was answered "no revision needed" before an offer
 * arrived that calls the estimate into question.
 *
 * The answer was given honestly, on the information available at the time;
 * this offer is new information. Reopened rather than flagged — nothing has
 * gone wrong, a question has simply been re-asked, and an agent who logs an
 * offer truthfully should not collect an amber mark for it.
 *
 * Only touches an item still answered "no". An answered "yes, revised" is left
 * alone, since the revision it records may well be the response to this.
 */
async function reopenStaleNoRevision(
  supabase: Awaited<ReturnType<typeof createClient>>,
  propertyId: string,
  reason: string,
): Promise<void> {
  const { data: row } = await supabase
    .from("property_items")
    .select("id, status, data")
    .eq("property_id", propertyId)
    .eq("item_key", "d3")
    .maybeSingle();

  const d3 = (row as { id?: string; status?: string; data?: { espRevised?: boolean } } | null) ?? null;
  if (!d3?.id || d3.status !== "done" || d3.data?.espRevised !== false) return;

  await supabase
    .from("property_items")
    .update({
      status: "open",
      completed_by: null,
      data: { ...d3.data, espRevised: undefined, reopenedReason: reason },
    })
    .eq("id", d3.id);
}

async function recheckAdvertisedPrice(propertyId: string, espChanged: boolean): Promise<void> {
  if (!espChanged) return;
  try {
    const { checkListingNow } = await import("@/lib/actions/website-scan");
    await checkListingNow(propertyId);
  } catch {
    // Deliberately silent — see above.
  }
}
