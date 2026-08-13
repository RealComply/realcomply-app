"use server";

import { createClient } from "@/lib/supabase/server";

// Early-access signup from the public landing page. Runs unauthenticated —
// this is the one action in the app reachable by a stranger — so it stays
// deliberately narrow: one field in, a boolean out, no reads.
//
// Uses the anon client rather than createServiceClient(). The service client
// bypasses RLS and its own file says never to reach it from a request driven
// by end-user input. The table's insert-only policy (0013) is what makes the
// anon path safe: this can add a row and cannot read one back.

export type EarlyAccessState = { ok: boolean; error: string | null };

// Deliberately permissive. The job here is to catch a typo or an empty box,
// not to adjudicate what is a valid address — over-strict patterns reject
// real addresses and the only cost of a bad one is a bounced email.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function joinEarlyAccess(
  _prevState: EarlyAccessState,
  formData: FormData,
): Promise<EarlyAccessState> {
  // Honeypot. A field hidden from people but not from naive form-fillers; if
  // it arrives with anything in it, accept the submission silently and drop it
  // on the floor rather than returning an error a bot could learn from.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { ok: true, error: null };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const source = String(formData.get("source") ?? "").trim().slice(0, 120) || null;

  if (!email) {
    return { ok: false, error: "Enter your email address." };
  }
  if (!EMAIL.test(email) || email.length > 320) {
    return { ok: false, error: "That does not look like an email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("early_access").insert({ email, source });

  if (error) {
    // 23505 = unique violation, i.e. already on the list. Treat as success:
    // they did what we asked, and saying "already registered" would confirm
    // to a stranger whether a given address is on the list.
    if (error.code === "23505") {
      return { ok: true, error: null };
    }
    // Anything else is ours, not theirs. Don't surface the database message.
    console.error("joinEarlyAccess insert failed:", error.message, error.code);
    return { ok: false, error: "Something went wrong at our end. Please try again." };
  }

  return { ok: true, error: null };
}
