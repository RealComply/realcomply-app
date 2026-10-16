// CPD certificates live in one place only: the CPD record (Adam, 15 Oct 2026).
// Pure rules, tested without a database:
//
//   * A CPD row says where its details came from: a training session, a
//     training plan, a certificate, or typed in. Only a row read off a
//     certificate says "Read from certificate" (the chip used to say it on
//     every row, including rows that never had one).
//   * Any row without a certificate takes one in that same place. The
//     certificate fills only what the row is missing; what the session or the
//     plan recorded is never overwritten.
//   * A training plan item linked to a CPD record shows that record's
//     certificate and never asks for one of its own. Only an item with no CPD
//     record (training that doesn't count for CPD) takes a document.

export type CpdRowSource = "session" | "plan" | "certificate" | "typed";

export const CPD_SOURCE_LABEL: Record<CpdRowSource, string> = {
  session: "From training session",
  plan: "From training plan",
  certificate: "Read from certificate",
  typed: "Typed in",
};

export function cpdRowSource(
  record: { id: string; source_session_id: string | null; evidence_path: string | null },
  planRecordIds: ReadonlySet<string>,
): CpdRowSource {
  if (record.source_session_id) return "session";
  if (planRecordIds.has(record.id)) return "plan";
  if (record.evidence_path) return "certificate";
  return "typed";
}

type Facts = { hours: number | null; completed_date: string | null; provider: string | null };

/**
 * What a certificate attached to an existing row may add: only the details
 * the row doesn't have. Nothing the session or plan recorded is replaced.
 */
export function fillFromCertificate(existing: Facts, read: Facts): Partial<Facts> {
  const fill: Partial<Facts> = {};
  if (existing.hours === null && read.hours !== null) fill.hours = read.hours;
  if (!existing.completed_date && read.completed_date) fill.completed_date = read.completed_date;
  if (!existing.provider && read.provider) fill.provider = read.provider;
  return fill;
}

/** What a training plan item shows for its document. */
export type PlanItemDocument =
  /** Linked to a CPD record: its certificate, or where to add it. Never asked for here. */
  | { kind: "cpd_record"; recordId: string; path: string | null; fileName: string | null }
  /** No CPD record: the item's own document, if one is attached. */
  | { kind: "own"; path: string | null; fileName: string | null };

export function planItemDocument(
  item: { cpd_record_id: string | null; evidence_path: string | null; evidence_file_name: string | null },
  recordsById: Record<string, { evidence_path: string | null; evidence_file_name: string | null } | undefined>,
): PlanItemDocument {
  if (item.cpd_record_id) {
    const record = recordsById[item.cpd_record_id];
    return {
      kind: "cpd_record",
      recordId: item.cpd_record_id,
      path: record?.evidence_path ?? null,
      fileName: record?.evidence_file_name ?? null,
    };
  }
  return { kind: "own", path: item.evidence_path, fileName: item.evidence_file_name };
}
