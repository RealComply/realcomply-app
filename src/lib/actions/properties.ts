"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildEvidencePath, finalizeEvidenceRecord, moveStagedEvidence } from "@/lib/storage/evidence";
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
    .select("agency_id")
    .eq("id", user.id)
    .single();

  if (!profile) {
    return { error: "No agency found for this account — contact support." };
  }

  const { data: property, error } = await supabase
    .from("properties")
    .insert({
      agency_id: profile.agency_id,
      created_by: user.id,
      address,
      property_type: propertyType,
      is_strata: isStrata,
      is_tenanted: isTenanted,
      has_pool: hasPool,
      agent_interest: agentInterest,
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
