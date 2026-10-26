// Agents in an office and the annexure their licensee adopted (brief, 14 Oct
// 2026): the read-only annexure page, the Home card that asks them to read it
// and their office's Supervision Guidelines, and the tick that records they
// have. The database side is 0069: office_annexure_adoption() tells an agent
// what was adopted (version, the licensee's name, the date) without opening
// the licensee's own adoption record, and confirm_sg_read() records the tick
// once.

/** The few Supabase calls this uses, so a test can stand in for the client. */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type OfficeAdoption = { version: string; adoptedByName: string; adoptedAt: string };

export const SG_READ_TITLE = "Read your office's Supervision Guidelines";
export const SG_READ_TEXT =
  "Your licensee in charge has adopted RealComply's annexure to your agency's Supervision Guidelines. Please read both.";
export const SG_READ_TICK = "I've read the RealComply annexure and my office's Supervision Guidelines.";
export const SG_READ_BUTTON = "Confirm";

/** What the caller's office adopted, or null (not adopted, an agent plan, or a failed read). */
export async function officeAdoption(supabase: Client): Promise<OfficeAdoption | null> {
  const { data, error } = await supabase.rpc("office_annexure_adoption");
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as { annexure_version: string; adopted_by_name: string; adopted_at: string };
  return { version: row.annexure_version, adoptedByName: row.adopted_by_name, adoptedAt: row.adopted_at };
}

/** Who sees the read-and-tick: an agent in an office. Not the licensee, an assistant or an agent on their own plan. */
export function isOfficeAgent(access: { actsAsLicensee: boolean; isAssistant: boolean; isAgentPlan: boolean }): boolean {
  return !access.actsAsLicensee && !access.isAssistant && !access.isAgentPlan;
}

/** Whether the Home card shows: the office has adopted, and this agent has not confirmed that version. */
export function sgReadDue(input: {
  officeAgent: boolean;
  adoption: OfficeAdoption | null;
  confirmedVersions: string[];
}): boolean {
  return input.officeAgent && input.adoption !== null && !input.confirmedVersions.includes(input.adoption.version);
}

/** The versions this person has confirmed reading (their own rows; 0069's policy). */
export async function myConfirmedVersions(supabase: Client, userId: string): Promise<string[] | null> {
  const { data, error } = await supabase
    .from("sg_read_confirmations")
    .select("annexure_version")
    .eq("confirmed_by", userId);
  if (error) return null;
  return ((data ?? []) as Array<{ annexure_version: string }>).map((r) => r.annexure_version);
}
