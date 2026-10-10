// Which agencies never enter the records window and are never deleted,
// whatever Stripe says. Brief of 8 Oct 2026, item 1, confirmed by Adam the
// same day.
//
// The same rule lives in the database as agency_is_protected() (0054), which
// is what actually stops ended_at being set. This copy is the second lock: the
// deletion job checks it in code as well, before it touches anything, so one
// mistake in one place cannot delete a real office.
//
// By id, never by name: an agency can rename itself. Comply Real Estate is
// comped but has no comped_by, so a comped_by check alone would miss it.

export const PROTECTED_AGENCY_IDS: ReadonlySet<string> = new Set([
  "b4763dfb-b33e-43bb-94ca-702a7e989a27", // Cass Property
  "2972edd0-7995-4946-803b-064d2a50baee", // Comply Real Estate
]);

export type ProtectionFacts = {
  id: string;
  status: string | null;
  comped_by: string | null;
  /** Whether any profile in the agency is a platform admin. */
  hasPlatformAdmin: boolean;
};

/** Why an agency is protected, or null when it is not. */
export function protectionReason(agency: ProtectionFacts): string | null {
  if (PROTECTED_AGENCY_IDS.has(agency.id)) return "named office";
  if (agency.status === "comped") return "comped";
  if (agency.comped_by) return "comped";
  if (agency.hasPlatformAdmin) return "platform owner's agency";
  return null;
}

export function isProtectedAgency(agency: ProtectionFacts): boolean {
  return protectionReason(agency) !== null;
}
