import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses Row Level Security entirely.
 *
 * Only for server-side code that has no logged-in user to scope queries to
 * (e.g. the weekly digest cron job, which needs to read across every
 * agency in one run). Never import this into anything reachable from a
 * client component or a request driven by end-user input — the anon-key
 * clients in server.ts / client.ts are the right choice everywhere RLS
 * should still apply.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY, a server-only secret (never prefixed
 * NEXT_PUBLIC_, never sent to the browser). Get it from Supabase project
 * settings → API → service_role key.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "createServiceClient: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    );
  }

  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
