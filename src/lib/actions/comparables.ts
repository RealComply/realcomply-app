"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import type { Weighting } from "@/lib/data/comparables";
import { MAX_MOST_COMPARABLE, MOST_COMPARABLE_REASON_MISSING, factorsFrom } from "@/lib/rules/comparables-rules";

// Everything the AGENT does to the comparables. Extraction writes the facts
// (see extraction.ts); this file writes the judgement.
//
// That split is the whole design. s72A makes the estimated selling price the
// agent's own opinion, so which sales they relied on, which they rejected and
// why can only ever be recorded by a person pressing something. Nothing in
// this file may be called by a model, and nothing in extraction.ts may set a
// weighting. See RealComply-comparable-sales-AI-notes-design.md.

export type ComparableActionState = { error: string | null };

/**
 * Marks how the agent treated one sale.
 *
 * Null clears it, which matters more than it looks: a weighting set by a
 * mis-tap must be removable, and "no answer yet" has to stay reachable. An
 * unweighted row is an honest state — a defaulted one is a record of a
 * decision nobody made. Since sales fold once marked (13 Oct 2026), that is
 * "Clear" on a card opened with "Change" (ComparablesPanel).
 */
export async function setComparableWeighting(
  propertyId: string,
  comparableId: string,
  weighting: Weighting | null,
): Promise<ComparableActionState> {
  const { supabase } = await requireAuthContext();

  // Only a sale relied on can be one of the 3 most comparable (0119), so a
  // sale moved off "Relied on" loses that mark too.
  const { error } = await supabase
    .from("property_comparables")
    .update(
      weighting === "relied"
        ? { weighting }
        : { weighting, most_comparable: false, most_comparable_reason: null, comparison_factors: [] },
    )
    .eq("id", comparableId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't save that. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * Marks a sale relied on as one of the 3 most comparable (Reg s12C, s12D(5);
 * 0119), with why and the comparison factors weighed (Reg s12F(1)(a)). The
 * reason is required; the database keeps it to 3, and to sales relied on.
 */
export async function setMostComparable(
  propertyId: string,
  comparableId: string,
  _prev: ComparableActionState,
  formData: FormData,
): Promise<ComparableActionState> {
  const { supabase } = await requireAuthContext();
  const reason = String(formData.get("mostComparableReason") ?? "").trim().slice(0, 2000);
  if (!reason) return { error: MOST_COMPARABLE_REASON_MISSING };
  const factors = factorsFrom(formData.getAll("comparisonFactors"));

  const { data, error } = await supabase
    .from("property_comparables")
    .update({ most_comparable: true, most_comparable_reason: reason, comparison_factors: factors })
    .eq("id", comparableId)
    .eq("property_id", propertyId)
    .eq("weighting", "relied")
    .select("id");

  if (error) {
    if (/Only 3 sales/.test(error.message)) {
      return { error: `Only ${MAX_MOST_COMPARABLE} sales can be marked as the most comparable. Take the mark off one first.` };
    }
    return { error: "Couldn't save that. Try again." };
  }
  if (!data || data.length === 0) return { error: "Mark the sale \u201cRelied on\u201d first." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/** Takes the "one of the 3 most comparable" mark off a sale, with its reason and factors. */
export async function clearMostComparable(propertyId: string, comparableId: string): Promise<ComparableActionState> {
  const { supabase } = await requireAuthContext();
  const { error } = await supabase
    .from("property_comparables")
    .update({ most_comparable: false, most_comparable_reason: null, comparison_factors: [] })
    .eq("id", comparableId)
    .eq("property_id", propertyId);
  if (error) return { error: "Couldn't save that. Try again." };
  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/** The agent's own words about one sale. Written by a person or dictated by one. */
export async function setComparableNote(
  propertyId: string,
  comparableId: string,
  note: string,
): Promise<ComparableActionState> {
  const { supabase } = await requireAuthContext();

  const { error } = await supabase
    .from("property_comparables")
    .update({ agent_note: note.trim() || null })
    .eq("id", comparableId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't save that note. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * A sale the agent knows about that the report did not list.
 *
 * Worth having even though the report is the evidence on file: an agent who
 * sold the house next door last month knows something no provider's export
 * does, and s72A(5) asks for evidence the estimate is reasonable, not evidence
 * that came from a particular vendor's database.
 */
export async function addComparable(
  propertyId: string,
  _prev: ComparableActionState,
  formData: FormData,
): Promise<ComparableActionState> {
  const { supabase, profile } = await requireAuthContext();

  const address = String(formData.get("address") ?? "").trim();
  if (!address) return { error: "Give the address." };

  const number = (name: string): number | null => {
    const raw = String(formData.get(name) ?? "").replace(/[$,\s]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const date = String(formData.get("saleDate") ?? "").trim() || null;

  const { error } = await supabase.from("property_comparables").insert({
    agency_id: profile.agency_id,
    property_id: propertyId,
    address,
    sale_price: number("salePrice"),
    sale_date: date,
    bedrooms: number("bedrooms"),
    bathrooms: number("bathrooms"),
    car_spaces: number("carSpaces"),
    land_size_sqm: number("landSizeSqm"),
    source: "agent",
    position: 900, // after the report's own list, which keeps the file's order
  });

  if (error) return { error: "Couldn't add that sale. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * Takes a row off the table.
 *
 * For a duplicate, a misread row, or a sale that isn't comparable.
 *
 * CHANGED 29 Sep 2026 (Adam): "if it's not a comparable property, it shouldn't
 * be there." Until then this was for duplicates only and a sale the agent had
 * ruled out was meant to be MARKED "not comparable" rather than removed. That
 * option has been retired; removing the row is now how a sale is ruled out.
 */
export async function removeComparable(
  propertyId: string,
  comparableId: string,
): Promise<ComparableActionState> {
  const { supabase, access } = await requireAuthContext();
  // Only the licensee deletes compliance records, and the delete is logged
  // (REVERSAL, Adam, 9 Oct 2026; was any member). The database refuses it
  // too (0058); this gives a plain message instead of a silent no-op.
  if (!access.actsAsLicensee) return { error: "Only the licensee in charge can remove a row." };

  const { error } = await supabase
    .from("property_comparables")
    .delete()
    .eq("id", comparableId)
    .eq("property_id", propertyId);

  if (error) return { error: "Couldn't remove that row." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}

/**
 * Confirms the subject property's own details.
 *
 * THE CONFIRMATION IS THE POINT, not the typing. These figures are read off
 * the comparables report and shown for checking, so the act being recorded
 * here is a person saying "yes, that is my property" — which is why
 * attributes_confirmed_at and _by are stamped and why extraction stops
 * offering suggestions afterwards.
 */
export async function confirmSubjectAttributes(
  propertyId: string,
  _prev: ComparableActionState,
  formData: FormData,
): Promise<ComparableActionState> {
  const { supabase, profile } = await requireAuthContext();

  const number = (name: string): number | null => {
    const raw = String(formData.get(name) ?? "").replace(/[,\s]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const { error } = await supabase
    .from("properties")
    .update({
      bedrooms: number("bedrooms"),
      bathrooms: number("bathrooms"),
      car_spaces: number("carSpaces"),
      land_size_sqm: number("landSizeSqm"),
      internal_area_sqm: number("internalAreaSqm"),
      condition_note: String(formData.get("conditionNote") ?? "").trim() || null,
      attribute_suggestions: null,
      attributes_confirmed_at: new Date().toISOString(),
      attributes_confirmed_by: profile.id,
    })
    .eq("id", propertyId);

  if (error) return { error: "Couldn't save those details. Try again." };

  revalidatePath(`/dashboard/${propertyId}`);
  return { error: null };
}
