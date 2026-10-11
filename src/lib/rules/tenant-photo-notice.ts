// t5 — tenant notice and permission for advertising photos (Adam, 5 Oct 2026).
//
// Two duties under the Residential Tenancies Act 2010, both live on a tenanted
// sale from 21 Sep 2026 (Residential Tenancies Amendment (Domestic Violence
// Reform) Act 2025):
//
//   s55AA  photos or video of the premises for publication need at least
//          7 days' notice to the tenant, and a fair chance to move their
//          things out of shot.
//   s55A   publishing photos that show the tenant's possessions needs their
//          written consent, and for sale or lease advertising (s55A(1B)) that
//          consent "must not be obtained earlier than 3 weeks before the
//          residential premises are first advertised".
//
// Adam's wording for the card, 5 Oct 2026: "Get the tenant's permission within
// the 3 weeks of the ad going live. Permission cannot be more than 3 week's
// old before publishing the listing." Uploading the tenant's email or text is
// optional; the tick and the date are the record.
//
// Section numbers are from the amending Act as made. The project's copy of the
// consolidated Act predates the amendments, so check them against the current
// Act before relying on them in anything formal.
//
// Pure functions only, so the card and setItemStatus apply the same rule.

/** Minimum notice before the shoot, in days (s55AA). */
export const PHOTO_NOTICE_DAYS = 7;

/** Oldest permission can be when the listing first goes live, in days (s55A(1B)). */
export const PERMISSION_MAX_AGE_DAYS = 21;

export const PERMISSION_RULE_TEXT =
  "Get the tenant's permission within the 3 weeks of the ad going live. Permission cannot be more than 3 weeks old before publishing the listing.";

export type TenantPhotoData = {
  /** Date of the photo or video shoot (yyyy-mm-dd). */
  shootDate?: string | null;
  /** The tenant gave permission to publish the photos. */
  permissionGiven?: boolean;
  /** When that permission was given (yyyy-mm-dd). */
  permissionDate?: string | null;
  /** None of the tenant's belongings are in the photos, so no permission is needed. */
  noBelongings?: boolean;
};

/** Whole days from a to b, both yyyy-mm-dd. Positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** yyyy-mm-dd, n days after d. */
export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * What stops the card being marked done. These are gaps in the record, so
 * the save is refused until they are filled.
 */
export function photoNoticeMissing(input: { noticeDate: string | null; data: TenantPhotoData }): string[] {
  const { noticeDate, data } = input;
  const missing: string[] = [];
  if (!noticeDate) missing.push("Enter the date notice was given to the tenant.");
  if (!data.shootDate) missing.push("Enter the date of the photo or video shoot.");
  if (!data.noBelongings) {
    if (!data.permissionGiven) {
      missing.push(
        "Tick that the tenant gave permission to publish the photos, or that none of their belongings are in them.",
      );
    } else if (!data.permissionDate) {
      missing.push("Enter the date the tenant gave permission.");
    }
  }
  return missing;
}

/**
 * What the recorded dates show went wrong. The card is flagged rather than
 * refused for these, the same as every other date check in the file: the
 * agent may have mistyped, and the product's job is to put the discrepancy in
 * front of a person, not to refuse to record what happened.
 *
 * launchDate is the "Listing launch date" card (c0). Until it is recorded the
 * permission can only be checked against itself.
 */
export function photoNoticeFlags(input: {
  noticeDate: string | null;
  data: TenantPhotoData;
  launchDate: string | null;
}): string[] {
  const { noticeDate, data, launchDate } = input;
  const flags: string[] = [];

  if (noticeDate && data.shootDate) {
    const gap = daysBetween(noticeDate, data.shootDate);
    if (gap < PHOTO_NOTICE_DAYS) {
      flags.push(
        `Only ${Math.max(gap, 0)} days' notice before the photos. The tenant must get at least ${PHOTO_NOTICE_DAYS} days' notice (s55AA).`,
      );
    }
  }

  if (!data.noBelongings && data.permissionGiven && data.permissionDate && launchDate) {
    const age = daysBetween(data.permissionDate, launchDate);
    if (age > PERMISSION_MAX_AGE_DAYS) {
      flags.push(
        `The tenant's permission is ${age} days older than the listing launch date. Permission cannot be more than 3 weeks old before publishing the listing (s55A).`,
      );
    } else if (age < 0) {
      flags.push(
        "The tenant's permission is dated after the listing went live. Permission has to be given before the photos are published (s55A).",
      );
    }
  }

  return flags;
}

/** Lines for the compliance record PDF under the card's status line. */
export function photoNoticeRecordLines(data: TenantPhotoData & { flagReasons?: string[] }, fmt: (d: string) => string): string[] {
  const lines: string[] = [];
  if (data.shootDate) lines.push(`Photo or video shoot: ${fmt(data.shootDate)}`);
  if (data.noBelongings) {
    lines.push("None of the tenant's belongings are in the photos, so permission was not needed");
  } else if (data.permissionGiven) {
    lines.push(
      data.permissionDate
        ? `Tenant gave permission to publish the photos: ${fmt(data.permissionDate)}`
        : "Tenant gave permission to publish the photos",
    );
  }
  return lines;
}
