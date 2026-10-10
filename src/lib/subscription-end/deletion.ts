import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";
import { backupConfig, listAllObjects } from "@/lib/backup/storage-backup";
import { activityDeleteAfter, deletionDate, longDate, onOrAfter, sydneyDate } from "./dates";
import { isProtectedAgency, protectionReason } from "./protected";
import { endedRecipients, FOOTER } from "./emails";
import { buildCertificatePdf, type DeletionCounts } from "./certificate";
import { renderEmailHtml, renderEmailText, type EmailDocument } from "@/lib/email/layout";

// The day-14 deletion (brief, item 6). Runs daily from
// /api/cron/subscription-end.
//
// For each agency whose deletion date has arrived, in this order:
//
//   1. Refuse a protected agency (the code list in protected.ts AND the
//      database's agency_is_protected(), both, before anything else) and
//      skip an agency on legal hold.
//   2. Copy the activity record and read it back. If that fails, stop, email
//      ADMIN_NOTIFICATION_EMAIL, and delete nothing.
//   3. Count what is about to be deleted, by category.
//   4. Delete the backup copies in AWS, then the files in Supabase Storage,
//      then the rows (one delete of the agency, which cascades to every
//      table), then the sign-in accounts. Backups first: if AWS refuses, the
//      live data is still there and tomorrow's run tries again, rather than
//      the live data being gone and its copies stranded.
//   5. Write the certificate and email it.
//   6. Log the run, with counts, in deletion_runs.
//
// SAFE TO RERUN. Every step can be repeated without harm, and a run that
// stops partway leaves a 'started' row holding what it needs (user ids,
// recipients) so the next run finishes it. The recipients are cleared from
// that row when the run completes.
//
// DRY RUN reports the counts without deleting anything, and logs that it did.
//
// REVERSAL, 2 Oct 2026 (Adam): source documents are kept for the life of the
// subscription, never purged at settlement. This job is the only thing that
// deletes them, 14 days after the subscription ends, with everything else.

export type DeletionOptions = {
  dryRun: boolean;
  /** Limit the run to one agency. */
  agencyId?: string;
  /**
   * Run for that one agency now rather than waiting for its deletion date.
   * Only with agencyId, and only for an agency that has ended. For testing
   * on a throwaway agency.
   */
  force?: boolean;
  /**
   * Dry run only: include every ended agency, not just those due today, so
   * the staff page can show what each would lose. Ignored on a real run.
   */
  allEnded?: boolean;
  now?: Date;
};

export type AgencyOutcome = {
  agencyRef: string;
  name: string | null;
  status: "dry_run" | "completed" | "skipped" | "blocked" | "failed";
  reason?: string;
  counts?: DeletionCounts;
  certificateNumber?: string;
};

export type DeletionReport = { dryRun: boolean; outcomes: AgencyOutcome[] };

type RunContext = {
  agencyName: string;
  endedAt: string;
  userIds: string[];
  recipients: string[];
  counts: DeletionCounts;
  emailed?: boolean;
};

type AgencyRow = {
  id: string;
  name: string;
  status: string | null;
  comped_by: string | null;
  ended_at: string | null;
  legal_hold: boolean | null;
};

export async function runDeletionJob(options: DeletionOptions): Promise<DeletionReport> {
  const supabase = createServiceClient();
  const now = options.now ?? new Date();
  const outcomes: AgencyOutcome[] = [];

  // Finish anything a previous run left partway, first. Not on a dry run.
  if (!options.dryRun) {
    const { data: open } = await supabase
      .from("deletion_runs")
      .select("id, agency_ref, context")
      .eq("status", "started")
      .eq("dry_run", false);
    for (const run of (open ?? []) as Array<{ id: number; agency_ref: string; context: RunContext | null }>) {
      if (options.agencyId && run.agency_ref !== options.agencyId) continue;
      outcomes.push(await resumeRun(supabase, run.id, run.agency_ref, run.context));
    }
  }

  let query = supabase
    .from("agencies")
    .select("id, name, status, comped_by, ended_at, legal_hold")
    .not("ended_at", "is", null);
  if (options.agencyId) query = query.eq("id", options.agencyId);
  const { data: rows, error } = await query;
  if (error) throw new Error(`could not read ended agencies: ${error.message}`);

  for (const agency of (rows ?? []) as AgencyRow[]) {
    if (outcomes.some((o) => o.agencyRef === agency.id)) continue;
    const due = onOrAfter(deletionDate(new Date(agency.ended_at!)), now);
    const forced = options.force && options.agencyId === agency.id;
    const preview = options.dryRun && options.allEnded;
    if (!due && !forced && !preview) continue;
    outcomes.push(await processAgency(supabase, agency, options.dryRun));
  }

  return { dryRun: options.dryRun, outcomes };
}

// ── One agency ─────────────────────────────────────────────────────────────

async function processAgency(supabase: SupabaseClient, agency: AgencyRow, dryRun: boolean): Promise<AgencyOutcome> {
  const base = { agencyRef: agency.id, name: agency.name };

  // 1. The guards. Two locks, both checked, before anything is read for
  // deletion.
  const refusal = await refusalFor(supabase, agency);
  if (refusal) {
    await logRun(supabase, { agency_ref: agency.id, dry_run: dryRun, status: "skipped", reason: refusal });
    return { ...base, status: "skipped", reason: refusal };
  }

  // 3. Counts (before 2, so a dry run can report them without copying).
  let counts: DeletionCounts;
  try {
    counts = await countsFor(supabase, agency.id);
  } catch (e) {
    const reason = `could not count records: ${message(e)}`;
    await logRun(supabase, { agency_ref: agency.id, dry_run: dryRun, status: "failed", reason });
    return { ...base, status: "failed", reason };
  }

  if (dryRun) {
    await logRun(supabase, { agency_ref: agency.id, dry_run: true, status: "dry_run", counts });
    return { ...base, status: "dry_run", counts };
  }

  // What the rest of the run needs once the agency rows are gone.
  const { data: people } = await supabase.from("profiles").select("id").eq("agency_id", agency.id);
  const context: RunContext = {
    agencyName: agency.name,
    endedAt: agency.ended_at!,
    userIds: ((people ?? []) as Array<{ id: string }>).map((p) => p.id),
    recipients: await endedRecipients(supabase, agency.id),
    counts,
  };

  const { data: run, error } = await supabase
    .from("deletion_runs")
    .insert({ agency_ref: agency.id, dry_run: false, status: "started", step: "activity", counts, context })
    .select("id")
    .single();
  if (error || !run) {
    return { ...base, status: "failed", reason: `could not log the run: ${error?.message ?? "no row"}` };
  }

  return resumeRun(supabase, (run as { id: number }).id, agency.id, context);
}

async function resumeRun(
  supabase: SupabaseClient,
  runId: number,
  agencyRef: string,
  context: RunContext | null,
): Promise<AgencyOutcome> {
  const base = { agencyRef, name: context?.agencyName ?? null };

  if (!context) {
    await finishRun(supabase, runId, { status: "failed", reason: "run has no context to resume from" });
    return { ...base, status: "failed", reason: "run has no context" };
  }

  const fail = async (step: string, reason: string): Promise<AgencyOutcome> => {
    await finishRun(supabase, runId, { status: "failed", step, reason });
    await alertAdmin(
      `Deletion stopped for ${context.agencyName}`,
      `The day-14 deletion stopped at "${step}": ${reason}. It will be tried again on the next run. Agency ref ${agencyRef}.`,
    );
    return { ...base, status: "failed", reason: `${step}: ${reason}` };
  };

  // While the agency row still exists, it can still be reactivated, made
  // protected, or put on hold. Check again: a resumed run must not act on a
  // state that has changed since it started.
  const { data: still } = await supabase
    .from("agencies")
    .select("id, name, status, comped_by, ended_at, legal_hold")
    .eq("id", agencyRef)
    .maybeSingle();
  if (still) {
    const row = still as AgencyRow;
    const refusal = !row.ended_at ? "reactivated" : await refusalFor(supabase, row);
    if (refusal) {
      await finishRun(supabase, runId, { status: "skipped", reason: refusal, clearContext: true });
      return { ...base, status: "skipped", reason: refusal };
    }
  }

  // 2. The activity record, copied and read back before anything is deleted.
  const { data: existing } = await supabase
    .from("activity_records")
    .select("agency_ref")
    .eq("agency_ref", agencyRef)
    .maybeSingle();
  if (!existing) {
    if (!still) return fail("activity", "the agency is gone but no activity record exists");
    const copied = await copyActivityRecord(supabase, agencyRef, context);
    if (!copied.ok) {
      // Blocked, not failed: nothing has been touched, and the brief says to
      // stop and tell Adam rather than delete without the record.
      await finishRun(supabase, runId, { status: "blocked", step: "activity", reason: copied.reason });
      await alertAdmin(
        `Deletion blocked for ${context.agencyName}: activity record not copied`,
        `The activity record could not be copied, so nothing was deleted. ${copied.reason}. Agency ref ${agencyRef}.`,
      );
      return { ...base, status: "blocked", reason: copied.reason };
    }
  }

  // 4a. Backup copies in AWS.
  await setStep(supabase, runId, "backups");
  const livePaths = await listPaths(supabase, agencyRef).catch((e) => e as Error);
  if (livePaths instanceof Error) return fail("backups", `could not list files: ${livePaths.message}`);
  const backups = await deleteBackupCopies(supabase, agencyRef, livePaths);
  if (!backups.ok) return fail("backups", backups.reason);

  // 4b. Files in Supabase Storage.
  await setStep(supabase, runId, "files");
  for (let i = 0; i < livePaths.length; i += 100) {
    const { error } = await supabase.storage.from(EVIDENCE_BUCKET).remove(livePaths.slice(i, i + 100));
    if (error) return fail("files", error.message);
  }
  const left = await listPaths(supabase, agencyRef).catch(() => null);
  if (left === null || left.length > 0) return fail("files", `${left?.length ?? "unknown"} files still present`);

  // 4c. The rows. One delete of the agency cascades to every table (every
  // agency table references agencies on delete cascade).
  await setStep(supabase, runId, "rows");
  {
    const { error } = await supabase.from("agencies").delete().eq("id", agencyRef);
    if (error) return fail("rows", error.message);
  }

  // 4d. The sign-in accounts. After the rows, because other rows point at
  // profiles and profiles point at the accounts.
  await setStep(supabase, runId, "accounts");
  for (const userId of context.userIds) {
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error && !/not.?found/i.test(error.message)) return fail("accounts", error.message);
  }

  // 5. The certificate.
  await setStep(supabase, runId, "certificate");
  const certificate = await writeCertificate(supabase, agencyRef, context).catch((e) => e as Error);
  if (certificate instanceof Error) return fail("certificate", certificate.message);

  if (!context.emailed) {
    await setStep(supabase, runId, "email");
    await emailCertificate(context, certificate);
    // A failed send is not retried against the subscriber, because the
    // addresses are about to be cleared. emailCertificate sends Adam the PDF
    // and the addresses instead, so it can be forwarded by hand.
    context.emailed = true;
    await supabase.from("deletion_runs").update({ context }).eq("id", runId);
  }

  // 6. Done. The recipients leave with the context.
  await finishRun(supabase, runId, {
    status: "completed",
    step: "done",
    certificateNumber: certificate.number,
    clearContext: true,
  });
  return { ...base, status: "completed", counts: context.counts, certificateNumber: certificate.number };
}

// ── Steps ──────────────────────────────────────────────────────────────────

async function refusalFor(supabase: SupabaseClient, agency: AgencyRow): Promise<string | null> {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("agency_id", agency.id)
    .eq("is_platform_admin", true)
    .limit(1);
  const facts = {
    id: agency.id,
    status: agency.status,
    comped_by: agency.comped_by,
    hasPlatformAdmin: ((admins ?? []) as unknown[]).length > 0,
  };
  if (isProtectedAgency(facts)) return `protected (${protectionReason(facts)})`;

  // The database's own list, as the second lock. Anything but a clear "no"
  // is a refusal.
  const { data: dbProtected, error } = await supabase.rpc("agency_is_protected", { p_agency_id: agency.id });
  if (error || dbProtected !== false) return "protected (database)";

  if (agency.legal_hold) return "legal hold";
  return null;
}

async function countsFor(supabase: SupabaseClient, agencyId: string): Promise<DeletionCounts> {
  const { data, error } = await supabase.rpc("agency_deletion_counts", { p_agency_id: agencyId });
  if (error || !data) throw new Error(error?.message ?? "no counts");
  const paths = await listPaths(supabase, agencyId);
  return { ...(data as Omit<DeletionCounts, "documents">), documents: paths.length };
}

async function listPaths(supabase: SupabaseClient, agencyId: string): Promise<string[]> {
  return (await listAllObjects(supabase, agencyId)).map((o) => o.path);
}

async function copyActivityRecord(
  supabase: SupabaseClient,
  agencyRef: string,
  context: RunContext,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: record, error } = await supabase.rpc("build_activity_record", { p_agency_id: agencyRef });
  if (error || !record) return { ok: false, reason: `could not build it: ${error?.message ?? "empty"}` };

  const endedAt = new Date(context.endedAt);
  const { error: insertError } = await supabase.from("activity_records").upsert({
    agency_ref: agencyRef,
    ended_at: context.endedAt,
    delete_after: `${activityDeleteAfter(endedAt)}T00:00:00+10:00`,
    counts: context.counts,
    record,
  });
  if (insertError) return { ok: false, reason: `could not save it: ${insertError.message}` };

  // Read back. "Confirm the copy succeeded" means seeing it, not trusting the
  // absence of an error.
  const { data: check } = await supabase
    .from("activity_records")
    .select("agency_ref, record")
    .eq("agency_ref", agencyRef)
    .maybeSingle();
  const saved = (check as { record?: { agency?: { id?: string } } } | null)?.record;
  if (saved?.agency?.id !== agencyRef) return { ok: false, reason: "it could not be read back" };
  return { ok: true };
}

/**
 * Deletes this agency's copies from the AWS backup bucket.
 *
 * With versioning on, a delete leaves the copy as an old version, which the
 * bucket's lifecycle rule removes for good after 90 days. That is what the
 * certificate's backups sentence promises. The backup user is deliberately
 * not allowed to delete old versions itself (see the AWS brief of 8 Oct).
 */
async function deleteBackupCopies(
  supabase: SupabaseClient,
  agencyId: string,
  livePaths: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { data: ledgerRows } = await supabase
    .from("storage_backups")
    .select("path")
    .like("path", `${agencyId}/%`);
  const ledger = ((ledgerRows ?? []) as Array<{ path: string }>).map((r) => r.path);
  const paths = [...new Set([...ledger, ...livePaths])];
  if (paths.length === 0) return { ok: true };

  const config = backupConfig();
  if (!config) {
    // Nothing was ever copied if the ledger is empty, so nothing to delete.
    if (ledger.length === 0) return { ok: true };
    return { ok: false, reason: "backup copies exist but the backup bucket is not configured" };
  }

  const s3 = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  for (let i = 0; i < paths.length; i += 1000) {
    const batch = paths.slice(i, i + 1000);
    try {
      const result = await s3.send(
        new DeleteObjectsCommand({
          Bucket: config.bucket,
          Delete: { Objects: batch.map((p) => ({ Key: `${EVIDENCE_BUCKET}/${p}` })), Quiet: true },
        }),
      );
      if (result.Errors && result.Errors.length > 0) {
        const first = result.Errors[0];
        return { ok: false, reason: `AWS refused ${result.Errors.length} deletes, e.g. ${first.Code}: ${first.Message}` };
      }
    } catch (e) {
      return { ok: false, reason: `AWS: ${message(e)}` };
    }
  }

  const { error } = await supabase.from("storage_backups").delete().like("path", `${agencyId}/%`);
  if (error) return { ok: false, reason: `could not clear the backup ledger: ${error.message}` };
  return { ok: true };
}

async function writeCertificate(
  supabase: SupabaseClient,
  agencyRef: string,
  context: RunContext,
): Promise<{ number: string; pdf: Uint8Array }> {
  const { data: existing } = await supabase
    .from("deletion_certificates")
    .select("certificate_number, pdf")
    .eq("agency_ref", agencyRef)
    .maybeSingle();
  if (existing) {
    const row = existing as { certificate_number: string; pdf: string | null };
    return { number: row.certificate_number, pdf: decodeBytea(row.pdf) };
  }

  const { data: number, error } = await supabase.rpc("next_deletion_certificate_number");
  if (error || typeof number !== "string") throw new Error(error?.message ?? "no certificate number");

  const endedAt = new Date(context.endedAt);
  const deletedAt = new Date();
  const keepUntil = activityDeleteAfter(endedAt);
  const pdf = await buildCertificatePdf({
    certificateNumber: number,
    subscriberName: context.agencyName,
    endedAt,
    deletedAt,
    counts: context.counts,
    activityDeleteAfter: keepUntil,
  });

  const { error: insertError } = await supabase.from("deletion_certificates").insert({
    certificate_number: number,
    agency_ref: agencyRef,
    subscriber_name: context.agencyName,
    ended_at: context.endedAt,
    deleted_at: deletedAt.toISOString(),
    counts: context.counts,
    delete_after: `${keepUntil}T00:00:00+10:00`,
    pdf: `\\x${Buffer.from(pdf).toString("hex")}`,
  });
  if (insertError) throw new Error(insertError.message);
  return { number, pdf };
}

/** PostgREST returns bytea as a "\x…" hex string. */
function decodeBytea(value: string | null): Uint8Array {
  if (!value) return new Uint8Array();
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return new Uint8Array(Buffer.from(hex, "hex"));
}

async function emailCertificate(context: RunContext, certificate: { number: string; pdf: Uint8Array }): Promise<void> {
  const endedOn = longDate(sydneyDate(new Date(context.endedAt)));
  const doc: EmailDocument = {
    preheader: `Certificate ${certificate.number} is attached.`,
    title: "Your records have been deleted",
    meta: context.agencyName,
    sections: [
      {
        kind: "paragraph",
        lead: true,
        text:
          `${context.agencyName}'s RealComply subscription ended on ${endedOn}, and its records have now ` +
          "been permanently deleted, as our terms set out.",
      },
      {
        kind: "paragraph",
        text:
          `The deletion certificate, number ${certificate.number}, is attached. It records categories and ` +
          "counts only, never contents.",
      },
    ],
    footer: FOOTER,
  };
  const message = {
    subject: `Deletion certificate ${certificate.number} for ${context.agencyName}`,
    text: renderEmailText(doc),
    html: renderEmailHtml(doc),
    attachments: [
      { filename: `RealComply deletion certificate ${certificate.number}.pdf`, content: certificate.pdf, contentType: "application/pdf" },
    ],
  };

  const failed: string[] = [];
  for (const to of context.recipients) {
    if (!(await sendEmail({ to, ...message }))) failed.push(to);
  }

  if (failed.length > 0 || context.recipients.length === 0) {
    const admin = process.env.ADMIN_NOTIFICATION_EMAIL;
    if (admin) {
      await sendEmail({
        to: admin,
        subject: `Forward by hand: deletion certificate ${certificate.number}`,
        text:
          `The deletion certificate for ${context.agencyName} could not be emailed to ` +
          `${failed.length > 0 ? failed.join(", ") : "anyone (no account holder or licensee on file)"}. ` +
          "It is attached so it can be forwarded by hand.",
        attachments: message.attachments,
      });
    }
  }
}

async function alertAdmin(subject: string, text: string): Promise<void> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("subscription-end: ADMIN_NOTIFICATION_EMAIL is not set.", { subject, text });
    return;
  }
  await sendEmail({ to, subject, text });
}

// ── The log ────────────────────────────────────────────────────────────────

async function logRun(
  supabase: SupabaseClient,
  row: { agency_ref: string; dry_run: boolean; status: string; reason?: string; counts?: DeletionCounts },
): Promise<void> {
  await supabase.from("deletion_runs").insert({ ...row, finished_at: new Date().toISOString() });
}

async function setStep(supabase: SupabaseClient, runId: number, step: string): Promise<void> {
  await supabase.from("deletion_runs").update({ step }).eq("id", runId);
}

async function finishRun(
  supabase: SupabaseClient,
  runId: number,
  fields: { status: string; step?: string; reason?: string; certificateNumber?: string; clearContext?: boolean },
): Promise<void> {
  // A failed run stays 'started' so the next run resumes it. Its reason is
  // recorded so the staff page shows why it is waiting.
  const resumable = fields.status === "failed";
  await supabase
    .from("deletion_runs")
    .update({
      status: resumable ? "started" : fields.status,
      ...(fields.step ? { step: fields.step } : {}),
      reason: fields.reason ?? null,
      ...(fields.certificateNumber ? { certificate_number: fields.certificateNumber } : {}),
      ...(fields.clearContext ? { context: null } : {}),
      ...(resumable ? {} : { finished_at: new Date().toISOString() }),
    })
    .eq("id", runId);
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── RealComply's own record, after 7 years ─────────────────────────────────

/** Deletes activity records and certificates whose 7 years are up. */
export async function expireActivityStore(now: Date = new Date()): Promise<{ records: number; certificates: number }> {
  const supabase = createServiceClient();
  const cutoff = now.toISOString();
  const { data: records } = await supabase.from("activity_records").delete().lt("delete_after", cutoff).select("agency_ref");
  const { data: certificates } = await supabase
    .from("deletion_certificates")
    .delete()
    .lt("delete_after", cutoff)
    .select("certificate_number");
  return { records: (records ?? []).length, certificates: (certificates ?? []).length };
}
