import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";
import { officeAdoption } from "@/lib/sg-annexure/office-read";
import { staffStillToDo, type ReminderPerson, type StillToDo } from "@/lib/staff-reminders/outstanding";

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
      supabase
        .from("staff_reminders")
        .select("profile_id, created_at")
        .eq("agency_id", profile.agency_id)
        .order("created_at", { ascending: false }),
      supabase.from("agencies").select("name").eq("id", profile.agency_id).maybeSingle(),
    ]);
  const docId = (sgDoc as { id: string } | null)?.id ?? null;
  const { data: sigs } = docId
    ? await supabase.from("signoff_signatures").select("document_id, signer_id, signed_at").eq("document_id", docId)
    : { data: [] };
  return {
    stillToDo: staffStillToDo({
      staff: (staffRows ?? []) as ReminderPerson[],
      senderId: profile.id,
      currentSgDocumentId: docId,
      signatures: (sigs ?? []) as Array<{ document_id: string; signer_id: string; signed_at: string | null }>,
      adoptedVersion: adoption?.version ?? null,
      readConfirmations: (reads ?? []) as Array<{ confirmed_by: string | null; annexure_version: string }>,
      reminders: (reminders ?? []) as Array<{ profile_id: string; created_at: string }>,
    }),
    sgVersionLabel: (versionRow as { version_label: string | null } | null)?.version_label?.trim() || null,
    officeName: ((agency as { name?: string } | null)?.name ?? "").trim(),
  };
}
