import { licenseeEmailState, type ConfirmationRow, type LicenseeEmailState, type LinkSend } from "@/lib/licensee-email/status";

// What the Office profile's "Licensee email" card shows (0112; Master,
// 4 Nov 2026). Read as the signed-in person: everyone in the office sees it.

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type LicenseeEmailCardData = { state: LicenseeEmailState; sends: LinkSend[] };

export async function licenseeEmailCard(
  supabase: Client,
  agencyId: string,
  licenseeEmail: string | null,
): Promise<LicenseeEmailCardData> {
  const email = (licenseeEmail ?? "").trim().toLowerCase();
  const [accepted, confirmation, sends] = await Promise.all([
    email ? supabase.rpc("licensee_email_confirmed", { p_agency: agencyId }) : Promise.resolve({ data: false }),
    email
      ? supabase
          .from("licensee_email_confirmations")
          .select("email, last_sent_at, last_send_error, confirmed_at")
          .eq("agency_id", agencyId)
          .eq("email", email)
          .is("superseded_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.rpc("licensee_link_sends"),
  ]);
  return {
    state: licenseeEmailState({
      email,
      accepted: (accepted as { data: unknown }).data === true,
      confirmation: ((confirmation as { data: unknown }).data ?? null) as ConfirmationRow | null,
    }),
    sends: (((sends as { data: unknown }).data ?? []) as LinkSend[]).filter((r) => r && r.sent_at),
  };
}
