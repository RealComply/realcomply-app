import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptableLegalVersions } from "@/lib/legal/documents";

// Has this person accepted the terms and privacy policy as they stand today?
//
// Added 2 Oct 2026 with the first lawyer-settled versions. Until then the only
// acceptance anyone ever gave was at signup, so publishing a new version would
// have left every existing user (Cass Property, today) operating under the
// August drafts with no record that they had seen the new text. The dashboard
// layout now asks this on every request and sends anyone who has not accepted
// the current pair to /accept-terms.
//
// Exact match on the pair, not "newer than". Versions are date strings and
// would sort, but the question a regulator asks is "did they accept THIS
// text", and only an exact match answers it. "Current" also takes in an
// earlier version listed in that document's `stillAccepted`, where the change
// since was not material to the people who accepted it (16 Oct 2026).
export function acceptsCurrentVersions(
  rows: { terms_version: string; privacy_version: string }[],
  acceptable: { terms: string[]; privacy: string[] } = acceptableLegalVersions(),
): boolean {
  return rows.some((r) => acceptable.terms.includes(r.terms_version) && acceptable.privacy.includes(r.privacy_version));
}

export async function hasAcceptedCurrentLegal(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const acceptable = acceptableLegalVersions();
  // RLS lets a person read only their own rows (0026), so the user_id filter
  // is belt and braces rather than the thing keeping this private.
  const { data, error } = await supabase
    .from("legal_acceptances")
    .select("terms_version, privacy_version")
    .eq("user_id", userId)
    .in("terms_version", acceptable.terms)
    .in("privacy_version", acceptable.privacy)
    .limit(1);

  // A failed read is not evidence that they have accepted. Sending someone to
  // the accept page they did not need is a click; letting them through on an
  // error would be a hole in the record that nobody would ever notice.
  if (error) return false;
  return acceptsCurrentVersions(data ?? [], acceptable);
}
