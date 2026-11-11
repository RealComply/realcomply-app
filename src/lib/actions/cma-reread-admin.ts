"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/data/current-profile";
import {
  cmaRereadSummary,
  cmaTestReadSummary,
  isCmaReread,
  isCmaTestRead,
  rereadComparablesReport,
  testReadComparablesReport,
} from "@/lib/documents/cma-reread";
import { createServiceClient } from "@/lib/supabase/service";

// Re-reads one of the three comparable-sales reports Adam asked for on 2 Nov
// 2026, from the staff page. RealComply staff only; the three listings only
// (lib/documents/cma-reread says what a re-read may and may not change).

export type CmaRereadState = { error: string | null; notice?: string };

export async function rereadCmaReport(_prev: CmaRereadState, formData: FormData): Promise<CmaRereadState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: "Only RealComply staff can do that." };
  const propertyId = String(formData.get("propertyId") ?? "");
  if (!isCmaReread(propertyId)) return { error: "That listing isn't one of the three to re-read." };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The reader isn't set up here: ANTHROPIC_API_KEY is missing." };

  const result = await rereadComparablesReport(
    createServiceClient(),
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    propertyId,
  );
  if ("error" in result) return { error: result.error };

  revalidatePath(`/dashboard/${propertyId}`);
  revalidatePath("/dashboard/admin");
  const summary = cmaRereadSummary(result);
  return result.read.outcome === "failed" || result.problems.length > 0
    ? { error: summary }
    : { error: null, notice: summary };
}

/**
 * A test read, nothing saved (Master, 11 Nov 2026; CMA_TEST_READS in
 * lib/documents/cma-reread): what the reader on this build would take from
 * the report. RealComply staff only.
 */
export async function testReadCmaReport(_prev: CmaRereadState, formData: FormData): Promise<CmaRereadState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: "Only RealComply staff can do that." };
  const propertyId = String(formData.get("propertyId") ?? "");
  if (!isCmaTestRead(propertyId)) return { error: "That listing isn't one RealComply staff can test-read." };
  if (!process.env.ANTHROPIC_API_KEY) return { error: "The reader isn't set up here: ANTHROPIC_API_KEY is missing." };

  const result = await testReadComparablesReport(
    createServiceClient(),
    new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    propertyId,
  );
  if ("error" in result) return { error: result.error };
  const summary = cmaTestReadSummary(result);
  return result.read.outcome === "read" ? { error: null, notice: summary } : { error: summary };
}
