"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { attachEvidenceFile } from "@/lib/storage/evidence";
import type { ActionState } from "@/lib/actions/auth";

// Optional documents collected at setup time, and which Stage 0/1 item each
// is attached to as evidence. Uploading here just means the file is already
// sitting on the right item when the agent gets to it — no re-uploading
// later. Reading these documents to pre-fill item data (dates, ESP figures,
// commission %) is a separate, not-yet-built step that needs the Claude API
// wired in; see RealComply-tech-stack-notes.md "Build status: compliance
// engine" for what's deferred and why.
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
