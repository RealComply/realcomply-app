import { sydneyDate } from "@/lib/format-date";
// Small date helpers shared by the PM screens.

/** Today in Sydney, as YYYY-MM-DD, for a date box's starting value. */
export function todayInSydney(): string {
  return sydneyDate();
}
