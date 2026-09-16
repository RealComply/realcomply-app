import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createServiceClient } from "@/lib/supabase/service";
import { EVIDENCE_BUCKET } from "@/lib/storage/evidence";

// Copying every uploaded document out to an independent bucket.
//
// WHY THIS EXISTS — the finding, 15 September 2026.
//
// SURA's underwriting questions asked whether backups are tested for
// restorability. Checking that honestly turned up something worse than the
// answer: **Supabase database backups do not include Storage objects.** Their
// documentation says so plainly.
//
// Every document an agency uploads lives in Storage. The database holds only
// the paths. So a perfect database restore gives a complete, correct database
// in which every document link points at nothing — the register would show
// July's reconciliation as uploaded and signed, and opening it would fail.
//
// For a product that exists to hold evidence an agency must keep for three
// years under s104, backing up the index and not the documents is close to
// backing up nothing.
//
// WHY AWS S3 AND NOT A SECOND SUPABASE PROJECT. The risk being covered is not
// only "Supabase loses data" — their durability is good and that is unlikely.
// It is the set of things durability does not cover: a bad migration, a wrong
// script, a compromised service-role key deleting objects (that key bypasses
// RLS entirely, by design), or loss of the account itself. A backup inside the
// same vendor answers none of those. AWS is already in use for SES in
// ap-southeast-2, so this adds a bucket rather than a relationship.
//
// SYDNEY, DELIBERATELY. The product tells agencies their data is stored in
// Australia. A backup in us-east-1 would quietly make that untrue, and the
// backup of a compliance record is still the compliance record.
//
// RESUMABLE AND BATCHED, because a serverless function has a time limit and
// some of these files are 30MB+ contracts. Each run copies up to `limit`
// objects and returns; anything left is picked up next run. A job that must
// finish in one pass is a job that fails permanently the day the bucket grows.
//
// NEVER DELETES. This copies and records; it does not mirror. If an object
// disappears from the source — whether by accident, by a bug, or by a document
// being replaced — the backup copy stays. That asymmetry IS the protection. A
// true mirror would faithfully replicate a mistaken deletion and leave nothing
// to recover from.

export type BackupResult = {
  ok: boolean;
  scanned: number;
  copied: number;
  skipped: number;
  failed: number;
  remaining: number | null;
  error?: string;
};

type StorageObject = {
  path: string;
  size: number | null;
  updatedAt: string | null;
};

function backupConfig() {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const region = process.env.BACKUP_AWS_REGION;
  const accessKeyId = process.env.BACKUP_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_AWS_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return { bucket, region, accessKeyId, secretAccessKey };
}

/** Whether the backup is configured at all — surfaced on the staff page. */
export function storageBackupConfigured(): boolean {
  return backupConfig() !== null;
}

/**
 * Every object in the evidence bucket, walking the folder tree.
 *
 * Supabase's list() returns one directory level at a time — an entry with no
 * `id` is a folder rather than a file. Evidence paths run three or four levels
 * deep (`<agency>/<property>/<item>/<file>`, `<agency>/_licences/<profile>/…`),
 * so this has to recurse rather than assume a depth. Depth is capped as a
 * guard against a pathological tree costing an entire run.
 */
async function listAllObjects(
  supabase: ReturnType<typeof createServiceClient>,
  prefix = "",
  depth = 0,
): Promise<StorageObject[]> {
  if (depth > 6) return [];

  const out: StorageObject[] = [];
  const PAGE = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(EVIDENCE_BUCKET)
      .list(prefix, { limit: PAGE, offset });

    // A failed listing is NOT an empty folder, and the original code treated
    // them identically — it broke out of the loop and returned [], so the run
    // reported "scanned 0, nothing outstanding" and the staff page went green
    // on a backup that could not see a single file. 16 Sep 2026: the bucket
    // held two agencies' documents and the panel said there was nothing to do.
    //
    // Throwing is right here. The caller turns it into a visible failure, and
    // a backup that cannot read its source has to shout rather than shrug.
    if (error) {
      throw new Error(
        `could not list "${prefix || "/"}" in ${EVIDENCE_BUCKET}: ${error.message}`,
      );
    }

    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // A folder placeholder has no id. Supabase also creates an
      // ".emptyFolderPlaceholder" object; there is nothing to back up in one.
      if (!entry.id) {
        out.push(...(await listAllObjects(supabase, path, depth + 1)));
        continue;
      }
      if (entry.name === ".emptyFolderPlaceholder") continue;

      out.push({
        path,
        size: (entry.metadata as { size?: number } | null)?.size ?? null,
        updatedAt: entry.updated_at ?? entry.created_at ?? null,
      });
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return out;
}

/**
 * How many documents are actually in the evidence bucket right now.
 *
 * The staff page needs this to say "N of M copied" rather than just "N copied".
 * A bare count of copies cannot tell you whether the backup is complete — a
 * job that silently sees nothing reports the same "0" as a genuinely empty
 * bucket, which is precisely how this went wrong on 16 Sep 2026.
 *
 * Returns null when the bucket could not be read, which the page shows as a
 * failure rather than as a zero.
 */
export async function countEvidenceObjects(): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const objects = await listAllObjects(supabase);
    return objects.length;
  } catch (e) {
    console.error("could not count evidence objects:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Copies anything new or changed into the backup bucket.
 *
 * Safe to run as often as you like: an object already recorded as backed up,
 * whose source has not changed since, is skipped without being downloaded.
 */
export async function runStorageBackup({ limit = 50 }: { limit?: number } = {}): Promise<BackupResult> {
  const config = backupConfig();
  if (!config) {
    // Not an error, and deliberately not a throw. Before the bucket exists this
    // job should say so plainly in the logs rather than fail a cron every night
    // and train everyone to ignore a red mark.
    return {
      ok: false,
      scanned: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
      remaining: null,
      error:
        "Backup is not configured. Set BACKUP_S3_BUCKET, BACKUP_AWS_REGION, BACKUP_AWS_ACCESS_KEY_ID and BACKUP_AWS_SECRET_ACCESS_KEY in Vercel.",
    };
  }

  const supabase = createServiceClient();
  const s3 = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  let objects: StorageObject[];
  try {
    objects = await listAllObjects(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("storage backup could not read the source bucket:", message);
    return {
      ok: false,
      scanned: 0,
      copied: 0,
      skipped: 0,
      failed: 0,
      remaining: null,
      error: `Could not read the source bucket — nothing was backed up. ${message}`,
    };
  }

  const { data: ledgerRows } = await supabase
    .from("storage_backups")
    .select("path, source_updated_at, backed_up_at");

  const ledger = new Map(
    ((ledgerRows ?? []) as Array<{
      path: string;
      source_updated_at: string | null;
      backed_up_at: string | null;
    }>).map((r) => [r.path, r]),
  );

  const pending = objects.filter((object) => {
    const row = ledger.get(object.path);
    if (!row || !row.backed_up_at) return true;
    // Changed since it was copied. Rare — paths carry a timestamp so a replaced
    // document usually arrives as a new path — but a re-upload to the same key
    // must not be missed.
    if (object.updatedAt && row.source_updated_at && object.updatedAt > row.source_updated_at) return true;
    return false;
  });

  const batch = pending.slice(0, limit);
  let copied = 0;
  let failed = 0;

  for (const object of batch) {
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(EVIDENCE_BUCKET)
        .download(object.path);

      if (downloadError || !blob) {
        throw new Error(downloadError?.message ?? "could not read the source object");
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());

      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          // The source path verbatim, so the first segment is still the agency
          // id and every object is attributable without this database.
          Key: `${EVIDENCE_BUCKET}/${object.path}`,
          Body: bytes,
          ContentType: blob.type || "application/octet-stream",
          // Belt and braces on top of the bucket's own default encryption.
          ServerSideEncryption: "AES256",
        }),
      );

      await supabase.from("storage_backups").upsert(
        {
          path: object.path,
          bucket: EVIDENCE_BUCKET,
          size_bytes: object.size,
          source_updated_at: object.updatedAt,
          backed_up_at: new Date().toISOString(),
          destination: `s3://${config.bucket}/${EVIDENCE_BUCKET}/${object.path}`,
          last_error: null,
          last_attempt_at: new Date().toISOString(),
        },
        { onConflict: "path" },
      );

      copied += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error("storage backup failed for", object.path, message);

      // Recorded rather than swallowed. A file that cannot be copied has to be
      // visible: attempts climbing against an empty backed_up_at is the signal.
      const existing = ledger.get(object.path);
      await supabase.from("storage_backups").upsert(
        {
          path: object.path,
          bucket: EVIDENCE_BUCKET,
          size_bytes: object.size,
          source_updated_at: object.updatedAt,
          backed_up_at: existing?.backed_up_at ?? null,
          attempts: 1,
          last_error: message.slice(0, 500),
          last_attempt_at: new Date().toISOString(),
        },
        { onConflict: "path" },
      );
    }
  }

  return {
    ok: failed === 0,
    scanned: objects.length,
    copied,
    skipped: objects.length - pending.length,
    failed,
    remaining: Math.max(0, pending.length - batch.length),
  };
}
