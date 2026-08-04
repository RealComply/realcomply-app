"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// Resolves the origin the request actually came in on (e.g. the exact
// Vercel domain the user is visiting), so the email confirmation link
// always points back to a domain that's live and in Supabase's redirect
// allow-list — rather than relying on Supabase's configured Site URL,
// which has drifted from the real production domain before.
async function getOrigin() {
  const headersList = await headers();
  const origin = headersList.get("origin");
  if (origin) return origin;
  const host = headersList.get("host");
  return `https://${host}`;
}

export type ActionState = { error: string | null };

export async function login(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/dashboard");
}

export async function signup(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "");
  const agencyName = String(formData.get("agencyName") ?? "");

  if (!agencyName.trim()) {
    return { error: "Agency name is required." };
  }

  const supabase = await createClient();
  const origin = await getOrigin();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, agency_name: agencyName },
      // Without this, Supabase falls back to its configured Site URL —
      // which sends the confirmation link to the bare site root instead
      // of /auth/callback, so the code exchange (and the agency/profile
      // bootstrap that depends on it) never runs. See tech-stack-notes.md.
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (signUpError) {
    return { error: signUpError.message };
  }

  // If email confirmation is required, there's no session yet — the
  // agency/profile bootstrap runs after they click the confirmation link
  // and land back in the app (see /auth/callback).
  if (!signUpData.session) {
    redirect(
      `/login?message=${encodeURIComponent(
        "Check your email to confirm your account, then sign in.",
      )}`,
    );
  }

  const { error: bootstrapError } = await supabase.rpc("bootstrap_agency", {
    p_agency_name: agencyName,
    p_full_name: fullName,
  });

  if (bootstrapError) {
    return { error: bootstrapError.message };
  }

  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
