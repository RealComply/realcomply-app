import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { allItemsFor } from "@/lib/rules/nsw-sales";
import { ruleContextFor } from "@/lib/data/rule-context";
import { buildComplianceRecordPdf, complianceRecordFilename } from "@/lib/pdf/compliance-record";
import { RULESET_VERSION } from "@/lib/rules/ruleset-version";
import type { Property, PropertyItem } from "@/lib/types";

// One click, one file in the Downloads folder.
//
// Content-Disposition: attachment is the whole point — it makes the browser
// save the file rather than display it, with no dialog and no decision. See the
// note on buildComplianceRecordPdf for why this matters more than convenience.
//
// Auth is the same as the page it sits under: requireProfile establishes the
// session, and RLS scopes the property lookup to the caller's own agency, so a
// guessed property id returns nothing rather than somebody else's file.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: property } = await supabase.from("properties").select("*").eq("id", id).maybeSingle();
  if (!property) notFound();
  const p = property as Property;

  const { data: rows } = await supabase.from("property_items").select("*").eq("property_id", id);
  const byKey = Object.fromEntries(((rows ?? []) as PropertyItem[]).map((i) => [i.item_key, i]));
  const items = allItemsFor(p, byKey, await ruleContextFor(supabase, p));

  const generatedAt = new Date();
  const pdf = await buildComplianceRecordPdf({
    property: p,
    items,
    byKey,
    rulesetVersion: RULESET_VERSION,
    preparedFor: profile.full_name ?? profile.email,
    generatedAt,
  });

  const filename = complianceRecordFilename(p, generatedAt);

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // Both forms: the plain one for older browsers, the UTF-8 one for
      // everything current. An address with an apostrophe in it should not
      // produce a file called "download".
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
