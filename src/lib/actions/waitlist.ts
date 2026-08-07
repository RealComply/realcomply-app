"use server";

import { createClient } from "@/lib/supabase/server";

// The /aml waitlist form action. Deliberately not "requireAuthContext" —
// there is no user, no session, no agency. This is a public marketing
// capture form, so it uses the same anon-key server client as everything
// else, but relies entirely on the aml_waitlist RLS policy (insert-only,
// anon allowed) rather than any profile/agency check.

export type WaitlistState = { status: "idle" | "error" | "success"; error: string | null };

export const initialWaitlistState: WaitlistState = { status: "idle", error: null };

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
}

export async function joinAmlWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const email = str(formData, "email");
  if (!email || !email.includes("@")) {
    return { status: "error", error: "Enter a real email address." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("aml_waitlist").insert({
    email: email.toLowerCase(),
    full_name: str(formData, "fullName"),
    agency_name: str(formData, "agencyName"),
    role: str(formData, "role"),
    property_count_band: str(formData, "propertyCountBand"),
    notes: str(formData, "notes"),
    source: "aml-landing",
  });

  if (error) {
    // Unique index on lower(email) — a repeat signup isn't a real error
    // from the visitor's point of view, it's confirmation they're already on
    // the list, so treat it as success rather than surfacing a DB message.
    if (error.code === "23505") {
      return { status: "success", error: null };
    }
    return { status: "error", error: "Couldn't join the waitlist — try again in a moment." };
  }

  return { status: "success", error: null };
}
