"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { attachEvidenceFile } from "@/lib/storage/evidence";
import type { ActionState } from "@/lib/actions/auth";

// Documents collected at setup time (now mandatory — see createProperty
// below), and which Stage 0/1 item each is attached to as evidence.
// Uploading here means the file is already sitting on the right item when
// the agent gets to it, and immediately available to
// src/lib/actions/extraction.ts's "Extract from uploaded documents" step.
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

  if (!address) {
    return { error: "Address is required." };
  }

  // Documents are mandatory at setup — enforced with `required` on the file
  // inputs client-side, and re-checked here since a Server Action is a real
  // POST endpoint that a bare form submission could otherwise bypass.
  for (const { field } of SETUP_EVIDENCE_FIELDS) {
    const file = formData.get(field);
    if (!(file instanceof File) || file.size === 0) {
      return { error: "Attach all three documents (agency agreement, contract for sale, comparable sales report) to create a property file." };
    }
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
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  // Attach whichever setup documents were provided. Best-effort — a failed
  // attachment here shouldn't block property creation, since the agent can
  // always attach the file directly on the item later.
  for (const { field, itemKey } of SETUP_EVIDENCE_FIELDS) {
    const file = formData.get(field);
    if (file instanceof File && file.size > 0) {
      await attachEvidenceFile(supabase, {
        agencyId: profile.agency_id,
        propertyId: property.id,
        itemKey,
        file,
      });
    }
  }

  redirect(`/dashboard/${property.id}`);
}
