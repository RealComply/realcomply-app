// What "Save attendance" changes on a training session. Pure, so the rule is
// tested in one place (recordAttendance in actions/registers.ts applies it).
//
// Only what changed (check, 10 Oct 2026). Saving used to delete the whole
// session's attendance and session CPD rows and write them all again. Since
// 0058 every delete goes into the 7-year record, so adding one latecomer
// logged every other attendee's records as deleted, and an agent's own
// correction to their session CPD (1.5 hours, not 2) was put back on every
// save. Now only someone unticked loses their rows, and only someone ticked
// who doesn't have them gets them.

export type AttendanceChanges = {
  /** Recorded as attending, now unticked: their attendance and session CPD go. */
  unticked: string[];
  /** Ticked, not yet recorded as attending. */
  ticked: string[];
  /**
   * Ticked, with no session CPD record. Every ticked attendee, not only the
   * newly ticked, so a save whose CPD write failed is mended by saving again,
   * as it was when every save rewrote the lot. An existing record is left as
   * it is, corrections and all.
   */
  needCpd: string[];
};

export function attendanceChanges(input: {
  /** profile_id of each training_attendance row for the session. */
  recorded: string[];
  /** profile_id of each cpd_records row with this source_session_id. */
  withCpd: string[];
  /** The boxes ticked on the form. */
  wanted: string[];
}): AttendanceChanges {
  const wanted = [...new Set(input.wanted)];
  const wantedSet = new Set(wanted);
  const recorded = new Set(input.recorded);
  const withCpd = new Set(input.withCpd);
  return {
    unticked: [...recorded].filter((id) => !wantedSet.has(id)),
    ticked: wanted.filter((id) => !recorded.has(id)),
    needCpd: wanted.filter((id) => !withCpd.has(id)),
  };
}
