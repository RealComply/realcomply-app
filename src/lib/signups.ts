import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// Whether anyone can create a brand-new agency from the public signup page.
//
// CLOSED BY DEFAULT (Adam, 24 Aug 2026: "at the moment, anyone can create an
// account from the landing page. Can we put a block on that like we had
// before?").
//
// ONE SWITCH, IN THE DATABASE — changed 26 Aug 2026, migration 0033.
//
// This used to read process.env.SIGNUPS_OPEN, and the check lived only in
// application code. That was a lock on the front door of a building whose side
// door was open. The anon key ships in every browser bundle, as it is designed
// to; Postgres default privileges had granted EXECUTE on bootstrap_agency_v2 to
// authenticated; and Supabase's "allow new users to sign up" has to stay on
// because invite signups go through the same call. So the sequence "create an
// account against the auth API, confirm your own address, call
// bootstrap_agency_v2 yourself" never touched a line of our code, and it worked.
//
// The switch is now a row that both sides read: the app, here, to decide what
// to render and whether to accept a signup; and bootstrap_agency_v2 itself, to
// refuse outright. Two layers, one answer, no way for them to disagree — which
// is the part an environment variable could never give us, because the database
// could not see it.
//
// Default-closed on purpose, and now in three senses: the column defaults to
// false, the SQL function coalesces a missing row to false, and the catch below
// answers false if the lookup fails at all. A switch nobody can read should
// fail towards nobody getting in.
//
// Wrapped in React's cache() so a page and the action behind it share one
// lookup per request.
export const openSignupsAllowed = cache(async function openSignupsAllowed(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("signups_open");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
});
