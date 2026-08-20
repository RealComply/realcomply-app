"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthContext } from "@/lib/actions/compliance";
import { buildEvidencePath, finalizeEvidenceRecord, moveStagedEvidence, EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { normaliseWebsiteUrl } from "@/lib/normalise-url";
import type { ActionState } from "@/lib/actions/auth";

// Documents collected at setup time (mandatory — see createProperty below),
// and which Stage 0/1 item each is attached to as evidence. The browser
// uploads these directly to Storage before this action ever runs (see
// NewPropertyForm.tsx and src/lib/storage/evidence.ts for why — Vercel
// Functions cap request bodies at 4.5MB, so real multi-MB contracts can
// never travel through a Server Action as file bytes). This action only
// ever sees the resulting staged path + original filename as plain
// strings, then moves the object to its permanent, property-scoped path
// once the property row exists.
const SETUP_EVIDENCE_FIELDS: Array<{ field: string; itemKey: string }> = [
  { field: "agencyAgreementFile", itemKey: "a3" }, // Agency agreement signed; copy served within 48 hours
  { field: "contractFile", itemKey: "b1" }, // Contract of sale prepared with prescribed documents
  { field: "comparableSalesFile", itemKey: "a4b" }, // Comparable-sales evidence held
];

// Creates a new property from the setup-question form (address, type,
// strata, tenanted, pool) — these answers are what drive which compliance
// items apply later (tenancy sub-module, strata pool-certificate
// exemption), per the rules schema's agency-binding model.
// Method of sale, shared by create and edit.
//
// The date and time are DELIBERATELY OPTIONAL (Adam, 18 Aug 2026): "on setting
// a listing for auction, there may not be an auction date or time... we have
// to leave space for a TBC". A property is very often listed for auction
// before the date is fixed. Requiring one would either block the listing or
// invite a made-up date, and a made-up date in a compliance record is worse
// than no date — so null means TBC and the app says so on screen.
function readSaleMethod(formData: FormData) {
  const saleMethod = formData.get("saleMethod") === "auction" ? "auction" : "private_treaty";
  const isAuction = saleMethod === "auction";
  return {
    saleMethod,
    auctionDate: isAuction ? String(formData.get("auctionDate") ?? "").trim() || null : null,
    auctionTime: isAuction ? String(formData.get("auctionTime") ?? "").trim() || null : null,
    auctionVenue: isAuction ? String(formData.get("auctionVenue") ?? "").trim() || null : null,
  };
}

export async function createProperty(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const address = String(formData.get("address") ?? "").trim();
  const propertyType = String(formData.get("propertyType") ?? "House");
  const isStrata = formData.get("isStrata") === "yes";
  const isTenanted = formData.get("isTenanted") === "yes";
  const hasPool = formData.get("hasPool") === "yes";
  const agentInterest = formData.get("agentInterest") === "yes";
  const { saleMethod, auctionDate, auctionTime, auctionVenue } = readSaleMethod(formData);

  if (!address) {
    return { error: "Address is required." };
  }

  // Documents are mandatory at setup — NewPropertyForm.tsx uploads each
  // file to Storage itself and only submits here once all three succeed,
  // but re-check that every staged path actually arrived, since a Server
  // Action is a real POST endpoint a bare form submission could bypass.
  const staged: Array<{ field: string; itemKey: string; path: string; fileName: string }> = [];
  for (const { field, itemKey } of SETUP_EVIDENCE_FIELDS) {
    const path = String(formData.get(`${field}StagedPath`) ?? "").trim();
    const fileName = String(formData.get(`${field}FileName`) ?? "").trim();
    if (!path || !fileName) {
      return {
        error: "Attach all three documents (agency agreement, contract for sale, comparable sales report) to create a property file.",
      };
    }
    staged.push({ field, itemKey, path, fileName });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("agency_id, is_assistant")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: "No agency found for this account — contact support." };
  }

  // Whose file is this?
  //
  // Normally the person creating it. An assistant creates files ON BEHALF OF
  // an agent, so the listing has to be attributed to that agent — otherwise
  // it never shows up as the agent's own work anywhere: not in their listings,
  // not in "waiting for your review", not in the Monday digest.
  //
  // Re-checked here rather than trusted from the form. The browser only says
  // "the assistant picked this agent"; whether they are allowed to is a fact
  // the server owns, and a hand-rolled POST must not be able to plant a file
  // on an agent the assistant has nothing to do with.
  let ownerId = user.id;
  if (profile.is_assistant) {
    const onBehalfOf = String(formData.get("onBehalfOf") ?? "").trim();
    if (!onBehalfOf) {
      return { error: "Choose which agent this listing is for." };
    }
    const { data: link } = await supabase
      .from("assistant_agents")
      .select("id")
      .eq("assistant_id", user.id)
      .eq("agent_id", onBehalfOf)
      .maybeSingle();
    if (!link) {
      return { error: "You don't support that agent. Ask the licensee in charge to attach you to them." };
    }
    ownerId = onBehalfOf;
  }

  const { data: property, error } = await supabase
    .from("properties")
    .insert({
      agency_id: profile.agency_id,
      created_by: ownerId,
      address,
      property_type: propertyType,
      is_strata: isStrata,
      is_tenanted: isTenanted,
      has_pool: hasPool,
      agent_interest: agentInterest,
      sale_method: saleMethod,
      auction_date: auctionDate,
      auction_time: auctionTime,
      auction_venue: auctionVenue,
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  // Relocate each staged upload to its permanent, property-scoped path and
  // record it as evidence. Best-effort per file — a problem with one
  // shouldn't block the others or the property that's already been
  // created; the agent can always re-attach directly on the item.
  for (const { itemKey, path, fileName } of staged) {
    const finalPath = buildEvidencePath(profile.agency_id, property.id, itemKey, fileName);
    const { error: moveError } = await moveStagedEvidence(supabase, { from: path, to: finalPath });
    if (moveError) continue;
    await finalizeEvidenceRecord(supabase, {
      agencyId: profile.agency_id,
      propertyId: property.id,
      itemKey,
      path: finalPath,
      fileName,
    });
  }

  redirect(`/dashboard/${property.id}`);
}

// Deletes a property and its whole compliance record. Licensee-in-charge
// only, enforced both here and at the DB level (0008_property_delete_
// licensee_only.sql tightened the RLS delete policy from "any agency
// member" to this same check, so this app-layer gate isn't the only thing
// standing between an agent and a destructive action they shouldn't have).
//
// Requires typing the address back exactly (case-insensitive) as a
// deliberate confirmation step — there's no undo once this runs.
//
// property_items cascade-deletes via the FK in 0001_init.sql, but Storage
// objects don't cascade with a database row, so any evidence files have to
// be collected and removed here explicitly or they'd be orphaned in the
// bucket forever with nothing left pointing at them.
export async function deleteProperty(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const confirmAddress = String(formData.get("confirmAddress") ?? "").trim();

  const { supabase, profile } = await requireAuthContext();

  if (!profile.is_licensee_in_charge) {
    return { error: "Only the licensee in charge can delete a property file." };
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, address")
    .eq("id", propertyId)
    .maybeSingle();

  if (!property) {
    return { error: "Property not found." };
  }

  if (confirmAddress.toLowerCase() !== property.address.trim().toLowerCase()) {
    return { error: "That doesn't match the property address — type it exactly as shown to confirm." };
  }

  const { data: items } = await supabase
    .from("property_items")
    .select("evidence_path")
    .eq("property_id", propertyId);

  const evidencePaths = (items ?? [])
    .map((item) => item.evidence_path)
    .filter((path): path is string => !!path);

  if (evidencePaths.length > 0) {
    // Best-effort — a Storage cleanup failure shouldn't block the delete
    // itself; an orphaned file with nothing pointing at it is a much
    // smaller problem than a property the licensee can no longer remove.
    await supabase.storage.from(EVIDENCE_BUCKET).remove(evidencePaths);
  }

  const { error } = await supabase.from("properties").delete().eq("id", propertyId);

  if (error) {
    return { error: "Couldn't delete the property — try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/portfolio");
  redirect("/dashboard");
}

// Editing a listing's setup answers after the fact.
//
// The setup form asks these once, at creation, and until now there was no way
// to change any of them — Adam ticked "has a pool" on a listing to try the
// pool item and then had no way to untick it (15 Aug 2026). That is a bad
// shape for answers that genuinely change: a listing becomes tenanted, or the
// strata question was answered wrong in a hurry.
//
// WHAT HAPPENS TO AN ITEM THAT DISAPPEARS. Nothing is deleted. b2 (pool
// certificate) only renders while has_pool is true, so unticking hides the
// card and leaves its row untouched in property_items. Tick it again and
// whatever was recorded is still there. Deleting on the way out would lose a
// real record because someone corrected a checkbox.
//
// test_mode is deliberately in the same panel. It is the flag that unlocks
// every stage for viewing (see maxViewable in the property page), which is
// what makes it possible to try the later-stage items — licensee sign-off in
// particular — without pushing a real listing through five stages first.
export async function updatePropertyDetails(
  propertyId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();

  const address = String(formData.get("address") ?? "").trim();
  if (!address) {
    return { error: "Address is required." };
  }

  const listingUrl = normaliseWebsiteUrl(String(formData.get("listingUrl") ?? ""));
  if (!listingUrl.ok) {
    return { error: listingUrl.error };
  }

  const sale = readSaleMethod(formData);

  const { error } = await supabase
    .from("properties")
    .update({
      address,
      // Empty string clears it rather than storing "", so "no listing page yet"
      // is one value (null) instead of two. Normalised so a pasted or typed
      // address without a scheme is accepted — see lib/normalise-url.ts.
      listing_url: listingUrl.url || null,
      property_type: String(formData.get("propertyType") ?? "House"),
      is_strata: formData.get("isStrata") === "yes",
      is_tenanted: formData.get("isTenanted") === "yes",
      has_pool: formData.get("hasPool") === "yes",
      agent_interest: formData.get("agentInterest") === "yes",
      // Switching a listing to private treaty does NOT hide the auction items
      // or their evidence — see isAuctionFile in rules/nsw-sales.ts. If the
      // campaign ran as an auction, that stays a fact about the file.
      sale_method: sale.saleMethod,
      auction_date: sale.auctionDate,
      auction_time: sale.auctionTime,
      auction_venue: sale.auctionVenue,
      test_mode: formData.get("testMode") === "yes",
      updated_at: new Date().toISOString(),
    })
    .eq("id", propertyId);

  if (error) {
    return { error: "Couldn't save those details. Try again." };
  }

  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard");
  return { error: null };
}
