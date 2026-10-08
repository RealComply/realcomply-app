// What the 7am Sydney listing-scan run does on a given morning.
//
// Until 31 October 2026 the advertised-price check runs weekly, exactly as it
// always has: every Monday at 7am Sydney time (Sunday 20:00 UTC under daylight
// saving), a fresh read of every live listing's page, no emails. The other
// mornings only find pages for live listings that have none yet.
//
// From 1 November 2026, when the new NSW legislation commences, the daily
// check takes over: every live listing every morning, with the no-price and
// below-ESP red flags emailed to the agent. The last weekly run is Monday 26
// October; the first daily run is Sunday 1 November. No gap, no overlap.

/** Midnight in Sydney on 1 November 2026, still daylight saving (+11:00). */
export const PRICE_CHECK_FROM = new Date("2026-11-01T00:00:00+11:00");

export type ScanMode = "daily" | "weekly" | "discovery";

const sydneyParts = (now: Date) =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

/** The hour of the day in Sydney, 0–23. The cron route runs only at 7. */
export function sydneyHour(now: Date): number {
  return Number(sydneyParts(now).find((p) => p.type === "hour")?.value);
}

export function scanModeAt(now: Date): ScanMode {
  if (now >= PRICE_CHECK_FROM) return "daily";
  return sydneyParts(now).find((p) => p.type === "weekday")?.value === "Mon" ? "weekly" : "discovery";
}
