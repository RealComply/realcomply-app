"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/actions/auth";

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

  redirect(`/dashboard/${property.id}`);
}
