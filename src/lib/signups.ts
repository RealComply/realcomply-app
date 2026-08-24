// Whether anyone can create a brand-new agency from the public signup page.
//
// CLOSED BY DEFAULT (Adam, 24 Aug 2026: "at the moment, anyone can create an
// account from the landing page. Can we put a block on that like we had
// before?").
//
// This closes a risk that has been sitting open in the launch notes since the
// first inbound lead. Email confirmation is currently OFF in Supabase — turned
// off on 19 Aug so Adam could invite his own team past the 2/hour cap — and
// `/signup` creates an agency without an invite. Together that means a stranger
// can create an account on an address they do not control, including somebody
// else's, and nothing checks. The launch-readiness doc names this as the
// condition that forces confirmation back on.
//
// INVITES ARE NOT AFFECTED, and that is the whole point. An invite is bound to
// one email address, can only be issued by a licensee in charge, and represents
// a human vouching for the person. That path stays open with signups closed,
// which is exactly the arrangement that made the confirmation-off period
// acceptable in the first place.
//
// Default-closed rather than default-open on purpose. A missing or misspelt
// environment variable should fail towards nobody getting in, not towards
// everybody.
export function openSignupsAllowed(): boolean {
  return process.env.SIGNUPS_OPEN === "true";
}
