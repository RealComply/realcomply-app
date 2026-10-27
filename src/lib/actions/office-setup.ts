"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isNotApplicableStep } from "@/lib/rules/office-setup";

// "Doesn't apply" on a "Set up your office" step, or taking it off again
// (0099; Adam, 27 Oct 2026). The database decides who may (the licensee in
// charge, an office manager, or the agent on their own plan) and records who
// and when. Home is then drawn again with the step done.

export async function setSetupNotApplicable(step: string, notApplicable: boolean): Promise<{ error: string | null }> {
  if (!isNotApplicableStep(step)) return { error: "That step can't be marked as not applying." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_office_setup_not_applicable", {
    p_step: step,
    p_not_applicable: notApplicable,
  });
  if (error) return { error: "Couldn't save that. Try again." };
  refresh();
  return { error: null };
}
