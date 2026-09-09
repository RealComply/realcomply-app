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
// Whether a founder invite link is still good — see migration 0045.
//
// A founder invite is the third door, and the one that fits "let a few friends
// try it" (Adam, 9 Sep 2026). The agency invite of 0006 puts somebody INTO an
// existing agency, which is wrong for a friend at another office and would show
// them Cass's listings. Opening signups is one global switch that lets in the
// friends and everybody else too. This is a single-use token that permits
// creating exactly one new agency, with signups still shut.
//
// Answering false on any failure, like openSignupsAllowed above and for the
// same reason. This is a convenience check anyway: the decision that counts is
// the atomic claim inside bootstrap_agency_v3, where the token is consumed by
// the same statement that validates it. This exists so somebody with a spent
// link is told so before they fill in a whole form.
export async function founderInviteValid(token: string): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("founder_invite_valid", { p_token: trimmed });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

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
