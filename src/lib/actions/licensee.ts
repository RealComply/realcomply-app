"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { validIsoDate } from "@/lib/insurance-read";

// Changing the licensee in charge, and recording dates on its history (0080;
// mockup approved by Adam, 16 Oct 2026).
//
// WHO: only the current licensee in charge of an office. Not an agent on their
// own plan, who has no history here. The database refuses everyone else too
// (change_licensee_in_charge, record_licensee_history_date), and does the whole
// change in one go: the role, the office's licensee details, the emailed links
// still out with the previous licensee, the documents waiting on them, and the
// history line.

export type ChangeLicenseeState = { error: string | null; done?: { name: string } };
export type HistoryDateState = { error: string | null; saved?: boolean };

const NOT_YOURS = "Only the licensee in charge can change the licensee in charge.";

// The database's refusals are written for the person reading them. Anything
// else (a dropped connection, say) gets a plain retry message.
const OWN_MESSAGES = [
  /^Only /,
  /^Choose someone on your team/,
  /^You are already/,
  /^An assistant agent/,
  /^Enter the date/,
  /^The date/,
  /^The change has to take effect/,
  /^Check the date/,
  /^The start date/,
  /^That line/,
  /already recorded/,
  /^This agency's subscription has ended/,
  /^Changing the licensee in charge is for offices/,
];

function readable(message: string | undefined, fallback: string): string {
  const m = (message ?? "").trim();
  return OWN_MESSAGES.some((re) => re.test(m)) ? m : fallback;
}

export async function changeLicenseeInCharge(
  _prev: ChangeLicenseeState,
  formData: FormData,
): Promise<ChangeLicenseeState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.officeLicensee || !profile.is_licensee_in_charge) return { error: NOT_YOURS };

  const newId = String(formData.get("newLicensee") ?? "").trim();
  const tookEffect = validIsoDate(formData.get("tookEffect"));
  const toldRaw = String(formData.get("fairTradingTold") ?? "").trim();
  const told = toldRaw ? validIsoDate(toldRaw) : null;
  if (!newId) return { error: "Choose the new licensee in charge." };
  if (!tookEffect) return { error: "Enter the date the change took effect." };
  if (toldRaw && !told) return { error: "Enter the date Fair Trading was told as a date, or leave it blank." };

  const { data: person } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", newId)
    .eq("agency_id", profile.agency_id)
    .maybeSingle();
  const name = (person as { full_name?: string | null; email?: string | null } | null)?.full_name?.trim()
    || (person as { email?: string | null } | null)?.email
    || "They";

  const { error } = await supabase.rpc("change_licensee_in_charge", {
    p_new_licensee: newId,
    p_took_effect: tookEffect,
    p_fair_trading_told: told,
  });
  if (error) {
    console.error("licensee in charge not changed:", error.message);
    return { error: readable(error.message, "Couldn't change the licensee in charge. Try again.") };
  }

  // Everything the role touches: the menu, Home, Billing, Team, Registers.
  revalidatePath("/dashboard", "layout");
  return { error: null, done: { name } };
}

/**
 * Fills in a blank date on a line of the history: when they started, or when
 * Fair Trading was told (the Home card's "I've told them: record the date").
 * Once per date; the database stamps who and when.
 */
export async function recordLicenseeHistoryDate(
  _prev: HistoryDateState,
  formData: FormData,
): Promise<HistoryDateState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.officeLicensee) return { error: "Only the licensee in charge can record this." };

  const lineId = String(formData.get("lineId") ?? "").trim();
  const which = String(formData.get("which") ?? "");
  const date = validIsoDate(formData.get("date"));
  if (!lineId || (which !== "started" && which !== "fair_trading")) return { error: "Something went wrong. Try again." };
  if (!date) return { error: "Enter the date." };

  const { error } = await supabase.rpc("record_licensee_history_date", { p_line: lineId, p_which: which, p_date: date });
  if (error) {
    console.error("licensee history date not recorded:", error.message);
    return { error: readable(error.message, "Couldn't record that date. Try again.") };
  }
  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard/home");
  return { error: null, saved: true };
}
