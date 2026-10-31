import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";

// Who has the Complaints register on screen, and its section of the
// registers export (lib/access.ts, seesComplaints).
//
// DECISION (Adam, 31 Oct 2026; 0102): an office manager the licensee in
// charge has approved reads the register and adds to it, "adding and read
// only". Until 0102 has run, the database still gives an office manager none
// of it, and the register would say "No complaints logged." when there may be
// some. So until then they don't get it at all, as before.
// complaint_file_addable() is new in 0102: it can't be called before it runs.

/** Whether this person sees the Complaints register. */
export async function complaintsRegisterShown(
  supabase: Pick<SupabaseClient, "rpc">,
  access: Pick<Access, "officeLicensee" | "seesComplaints">,
): Promise<boolean> {
  if (access.officeLicensee) return true;
  if (!access.seesComplaints) return false;
  const { error } = await supabase.rpc("complaint_file_addable", { p_name: "" });
  return !error;
}
