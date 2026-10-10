import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/data/current-profile";
import { auditPackResponse, buildAuditPack } from "@/lib/pdf/audit-pack";
import { endedStateFor } from "@/lib/subscription-end/access";

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

  // Once a subscription has ended, only the licensee in charge and the
  // account holder may download records (brief of 8 Oct 2026, item 2).
  const ended = await endedStateFor(supabase, profile);
  if (ended && !ended.mayUseRecords) notFound();

  // The building itself, unchanged, lives in lib/pdf/audit-pack.ts.
  const pack = await buildAuditPack(supabase, id, profile.agency_id, profile.full_name ?? profile.email);
  if (!pack) notFound();

  return auditPackResponse(pack);
}
