import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { officeAdoption } from "@/lib/sg-annexure/office-read";
import { staffStillToDo, type ReminderPerson, type StillToDo } from "@/lib/staff-reminders/outstanding";
import { sgAmendmentSigners, sgAmendmentsFor } from "@/lib/data/sg-document";
import { amendmentRef } from "@/lib/sg-document/amendments";

// What the reminder card and the send action read (0093). With the reader's
// own access: the licensee or an office manager sees every row these need.
// Before 0093 is run staff_reminders doesn't exist; the list still works,
// with no "last reminded".

export type StaffReminderData = { stillToDo: StillToDo[]; sgVersionLabel: string | null; officeName: string };

export async function staffReminderData(supabase: SupabaseClient, profile: Profile): Promise<StaffReminderData> {
  const [{ data: staffRows }, { data: sgDoc }, { data: versionRow }, adoption, { data: reads }, { data: reminders }, { data: agency }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, is_agent, is_assistant, is_licensee_in_charge, archived_at")
        .eq("agency_id", profile.agency_id),
      // The newest all-staff SG Manual version: the one the SG Manual page shows.
      supabase
        .from("signoff_documents")
        .select("id")
        .eq("agency_id", profile.agency_id)
        .eq("category", "sg_manual")
        .eq("signer_scope", "all_staff")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("sg_manual_versions")
        .select("version_label")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      officeAdoption(supabase),
      supabase.from("sg_read_confirmations").select("confirmed_by, annexure_version").eq("agency_id", profile.agency_id),
      // Only reminders that went: one whose email failed can be sent again (0094).
      supabase
        .from("staff_reminders")
        .select("profile_id, email_sent_at")
        .eq("agency_id", profile.agency_id)
        .not("email_sent_at", "is", null)
        .order("email_sent_at", { ascending: false }),
      supabase.from("agencies").select("name").eq("id", profile.agency_id).maybeSingle(),
    ]);
  const docId = (sgDoc as { id: string } | null)?.id ?? null;
  const { data: sigs } = docId
    ? await supabase.from("signoff_signatures").select("document_id, signer_id, signed_at").eq("document_id", docId)
    : { data: [] };
  // Changes to the live supervision guidelines still to sign (0125). Before
  // 0125 there's no table: none.
  const { data: liveDoc } = await supabase
    .from("sg_documents")
    .select("id")
    .eq("agency_id", profile.agency_id)
    .eq("status", "live")
    .limit(1)
    .maybeSingle();
  const changes = liveDoc
    ? (await sgAmendmentsFor(supabase, (liveDoc as { id: string }).id))
        .filter((a) => a.status === "approved")
        .sort((x, y) => (x.refNo ?? 0) - (y.refNo ?? 0))
    : [];
  const changeSigners = await sgAmendmentSigners(
    supabase,
    changes.map((a) => a.id),
  );
  return {
    stillToDo: staffStillToDo({
      staff: (staffRows ?? []) as ReminderPerson[],
      senderId: profile.id,
      currentSgDocumentId: docId,
      signatures: (sigs ?? []) as Array<{ document_id: string; signer_id: string; signed_at: string | null }>,
      adoptedVersion: adoption?.version ?? null,
      readConfirmations: (reads ?? []) as Array<{ confirmed_by: string | null; annexure_version: string }>,
      changes: changes.map((a) => ({ id: a.id, ref: amendmentRef(a) })),
      changeSignatures: changes.flatMap((a) => (changeSigners.get(a.id) ?? []).map((profile_id) => ({ amendment_id: a.id, profile_id }))),
      reminders: ((reminders ?? []) as Array<{ profile_id: string; email_sent_at: string }>).map((r) => ({
        profile_id: r.profile_id,
        created_at: r.email_sent_at,
      })),
    }),
    sgVersionLabel: (versionRow as { version_label: string | null } | null)?.version_label?.trim() || null,
    officeName: ((agency as { name?: string } | null)?.name ?? "").trim(),
  };
}
