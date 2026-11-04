import { createServiceClient } from "@/lib/supabase/service";
import type { SendEmailInput } from "@/lib/email/send";
import { sendLicenseeConfirmation } from "@/lib/licensee-email/send";

// The daily job's part of confirm first (0112; Master, 4 Nov 2026): each
// licensee email that has never been sent the confirm email gets it, once.
// That is every existing office's current address the first day after 0112
// (Master: tell me which offices are affected first; the dry run lists them),
// then any address whose first send failed or that was changed in the
// database. Never an agent's own plan (pending_licensee_confirmations()).

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ConfirmRun = {
  dryRun: boolean;
  offices: Array<{ office: string; email: string; outcome: "would_send" | "sent" | "not_needed" | "failed" }>;
  sent: number;
  failed: number;
};

export async function runLicenseeConfirmations(
  opts: { dryRun?: boolean; service?: Client; send?: (input: SendEmailInput) => Promise<boolean> } = {},
): Promise<ConfirmRun> {
  const service = opts.service ?? (createServiceClient() as unknown as Client);
  const { data, error } = await service.rpc("pending_licensee_confirmations");
  if (error) throw new Error(`Couldn't list the licensee emails to confirm: ${error.message}`);
  const pending = (data ?? []) as Array<{ agency_id: string; office_name: string; email: string }>;

  const run: ConfirmRun = { dryRun: Boolean(opts.dryRun), offices: [], sent: 0, failed: 0 };
  for (const p of pending) {
    if (opts.dryRun) {
      run.offices.push({ office: p.office_name, email: p.email, outcome: "would_send" });
      continue;
    }
    const outcome = await sendLicenseeConfirmation(service, p.agency_id, { onlyIfNeverSent: true, send: opts.send });
    if (outcome === "sent") run.sent += 1;
    if (outcome === "failed") run.failed += 1;
    run.offices.push({ office: p.office_name, email: p.email, outcome });
  }
  return run;
}

/** What the monitoring counts as a problem: a confirm email that didn't go. */
export function confirmRunProblems(run: ConfirmRun): string[] {
  return run.failed > 0
    ? [`${run.failed} licensee confirm email${run.failed === 1 ? "" : "s"} couldn't be sent. They'll be tried again tomorrow.`]
    : [];
}
