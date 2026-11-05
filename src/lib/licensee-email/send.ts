import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { buildLicenseeConfirmEmail } from "@/lib/email/licensee-confirm";
import { appBaseUrl } from "@/lib/site-url";

// Sending the confirm email to the licensee address (0112; Master, 4 Nov
// 2026). Server only, with the service key: the token is read here and
// nowhere else. Never throws.

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ConfirmSendOutcome = "sent" | "not_needed" | "failed";

export function licenseeConfirmUrl(token: string, base = appBaseUrl()): string {
  return `${base}/licensee-confirm/${token}`;
}

/**
 * Sends the confirm email for the office's licensee email, if it needs one:
 * made for this address (licensee_confirmation_for) unless confirmationId is
 * given. "not_needed" when there is no address, it is the licensee's own
 * login, or it has already confirmed. Records whether it went.
 */
export async function sendLicenseeConfirmation(
  service: Client,
  agencyId: string,
  opts: {
    confirmationId?: string | null;
    replyTo?: string | null;
    /** Sign-up, the daily job, Stripe's repeated events: only if it has never gone. */
    onlyIfNeverSent?: boolean;
    /** A new office's SG annexure request waits for this click (0112). */
    annexureWaiting?: boolean;
    send?: (input: SendEmailInput) => Promise<boolean>;
  } = {},
): Promise<ConfirmSendOutcome> {
  const send = opts.send ?? sendEmail;
  try {
    let id = opts.confirmationId ?? null;
    if (!id) {
      const { data, error } = await service.rpc("licensee_confirmation_for", { p_agency: agencyId });
      if (error) {
        console.error("licensee confirm: could not make the confirmation", agencyId, error.message);
        return "failed";
      }
      id = typeof data === "string" ? data : null;
    }
    if (!id) return "not_needed";

    const { data: row } = await service
      .from("licensee_email_confirmations")
      .select("id, agency_id, email, token, confirmed_at, superseded_at, last_sent_at")
      .eq("id", id)
      .maybeSingle();
    const c = row as {
      agency_id: string;
      email: string;
      token: string;
      confirmed_at: string | null;
      superseded_at: string | null;
      last_sent_at: string | null;
    } | null;
    if (!c || c.agency_id !== agencyId || c.confirmed_at || c.superseded_at) return "not_needed";
    if (opts.annexureWaiting) {
      await service.from("licensee_email_confirmations").update({ annexure_waiting: true }).eq("id", id);
    }
    if (opts.onlyIfNeverSent && c.last_sent_at) return "not_needed";

    const { data: agency } = await service.from("agencies").select("name").eq("id", agencyId).maybeSingle();
    const officeName = ((agency as { name?: string | null } | null)?.name ?? "").trim() || "your office";
    const email = buildLicenseeConfirmEmail({ officeName, url: licenseeConfirmUrl(c.token) });

    let ok = false;
    try {
      ok = await send({ to: c.email, ...email, ...(opts.replyTo ? { replyTo: opts.replyTo } : {}) });
    } catch (err) {
      console.error("licensee confirm: send threw", agencyId, err);
    }
    await service.rpc("record_licensee_confirmation_email", { p_id: id, p_sent: ok });
    return ok ? "sent" : "failed";
  } catch (err) {
    console.error("licensee confirm: failed", agencyId, err);
    return "failed";
  }
}
