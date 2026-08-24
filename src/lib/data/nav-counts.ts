import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expiryStatus } from "@/lib/expiry-status";
import type { Profile } from "@/lib/types";

// The numbers on the sidebar rows.
//
// WHY THEY EXIST. The sidebar was built with room for these and they were
// never plumbed through — the original comment in Sidebar.tsx says as much:
// "the badges themselves are a follow-up (they need counts plumbed through the
// layout)". Adam, 24 Aug 2026, after looking at the CRM research: an open flag
// or an outstanding signature should be visible from any page, not only once
// you have navigated to the register that holds it.
//
// This is also the one place the research said nobody else goes. Every CRM
// examined expresses compliance state as a colour in a list you have to be
// looking at. None of them carry it in the chrome.
//
// HONESTY RULE. A badge is a claim that something needs a person. Each count
// below is deliberately narrow enough to be true:
//
//   listings  — files carrying a flagged item. Not "incomplete": a file in its
//               first week is incomplete and nothing is wrong with it.
//   signoffs  — documents awaiting THIS person's signature. Not the office's
//               queue, which would nag six people about one document.
//   registers — staff whose licence has expired or expires within 30 days.
//
// Anything vaguer would train people to ignore the number, which is worse than
// having no number at all.
//
// COST. This runs in the dashboard layout, so it runs on every page. Four
// small indexed selects, issued in parallel, all agency-scoped by RLS. Wrapped
// in cache() for the same reason requireProfile is: one lookup per request.

export type NavCounts = {
  listings: number;
  signoffs: number;
  registers: number;
  /** Red where a licence has actually expired, amber where one is close. */
  registersTone: "amber" | "red";
};

export const EMPTY_NAV_COUNTS: NavCounts = { listings: 0, signoffs: 0, registers: 0, registersTone: "amber" };

export const navCountsFor = cache(async function navCountsFor(
  supabase: SupabaseClient,
  profile: Profile,
): Promise<NavCounts> {
  const [{ data: propertyRows }, { data: flaggedRows }, { count: signoffCount }, { data: licenceRows }] =
    await Promise.all([
      // Needed only to drop test listings. Adam runs files in test mode to try
      // things out, and a badge that counts his sandbox is a badge he learns
      // to ignore. property_items has no test_mode of its own, so the filter
      // has to happen here rather than in the query.
      supabase.from("properties").select("id, test_mode"),
      supabase.from("property_items").select("property_id").eq("status", "flagged"),
      supabase
        .from("signoff_signatures")
        .select("id", { count: "exact", head: true })
        .eq("signer_id", profile.id)
        .is("signed_at", null),
      supabase.from("profiles").select("licence_expiry").not("licence_expiry", "is", null),
    ]);

  const realProperties = new Set(
    ((propertyRows ?? []) as { id: string; test_mode: boolean }[]).filter((p) => !p.test_mode).map((p) => p.id),
  );

  // Distinct files, not distinct flags. Three flags on one listing is one
  // listing to go and look at.
  const flaggedProperties = new Set(
    ((flaggedRows ?? []) as { property_id: string }[])
      .map((r) => r.property_id)
      .filter((id) => realProperties.has(id)),
  );

  const licences = ((licenceRows ?? []) as { licence_expiry: string | null }[]).map((r) =>
    expiryStatus(r.licence_expiry),
  );
  const expired = licences.filter((s) => s === "expired").length;
  const urgent = licences.filter((s) => s === "urgent").length;

  return {
    listings: flaggedProperties.size,
    signoffs: signoffCount ?? 0,
    // "soon" (within 90 days) is deliberately excluded. A licence three months
    // out is a reminder, not a badge — the licence reminder emails already
    // cover that cadence, and a number that never reaches zero stops meaning
    // anything.
    registers: expired + urgent,
    registersTone: expired > 0 ? "red" : "amber",
  };
});
