import { READERS, type ReaderName } from "@/lib/documents/read-record";
import type { ReadFailureWhy } from "@/lib/documents/read-core";
import type { EmailDocument, EmailRow, EmailSection } from "@/lib/email/layout";
import { renderEmailHtml, renderEmailText } from "@/lib/email/layout";
import { sendEmail } from "@/lib/email/send";
import { formatAuDate } from "@/lib/format-date";
import { sydneyDate } from "@/lib/subscription-end/dates";

// ADAM'S WEEKLY STAFF EMAIL: the week's document reads (Adam, 1 Nov 2026).
// "Add to Adam's weekly staff email: reads done, reads failed, CMAs with 0
// comparables, for the week." There was no weekly staff email, so this is its
// start: to Adam only (ADMIN_NOTIFICATION_EMAIL), never to an office, sent each
// Monday morning by the weekly digest job. From the record of reads
// (supabase/migrations/0103): every read in every office over the 7 days
// before the email.

type Db = {
  from: (table: string) => {
    select: (columns: string) => {
      gte: (column: string, value: string) => {
        order: (column: string) => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
      };
      in: (column: string, values: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

type ReadRow = {
  agency_id: string;
  property_id: string | null;
  reader: string;
  outcome: "read" | "nothing_found" | "wrong_document" | "failed";
  why: string | null;
  sales: number | null;
  read_at: string;
};

export type ReaderWeek = {
  /** The last day of the week, YYYY-MM-DD (Sydney). */
  weekTo: string;
  done: number;
  failed: number;
  byReader: Array<{ reader: string; done: number; failed: number }>;
  failedBecause: Array<{ why: string; n: number }>;
  /** Comparable-sales reports that gave 0 comparables (read to the end, or the wrong document). */
  zeroComparables: Array<{ office: string; listing: string; at: string }>;
};

const WHY_LABELS: Record<ReadFailureWhy, string> = {
  cut_off: "Cut off at the length limit",
  unparseable: "Answer couldn't be used",
  refused: "The reader declined",
  no_answer: "No answer",
  too_large: "File too large",
  unsupported: "File type the reader can't take",
  file: "File wouldn't open or download",
  service: "AI service error",
  other: "Something else (see Vercel's logs)",
};

const readerLabel = (r: string) => {
  const label = READERS[r as ReaderName] ?? r.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** The week's figures from the record of reads. Service key only: every office. */
export async function loadReaderWeek(supabase: Db, now: Date): Promise<ReaderWeek> {
  const since = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const rows: ReadRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("document_reads")
      .select("agency_id, property_id, reader, outcome, why, sales, read_at")
      .gte("read_at", since)
      .order("read_at")
      .range(from, from + 999);
    if (error) throw new Error(`the record of reads couldn't be read: ${error.message}`);
    const page = (data ?? []) as ReadRow[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const zero = rows.filter((r) => r.reader === "comparable_sales" && r.outcome !== "failed" && (r.sales ?? 0) === 0);
  const agencyIds = [...new Set(zero.map((r) => r.agency_id))];
  const propertyIds = [...new Set(zero.map((r) => r.property_id).filter((id): id is string => Boolean(id)))];
  const [agencies, properties] = await Promise.all([
    agencyIds.length ? supabase.from("agencies").select("id, name").in("id", agencyIds) : Promise.resolve({ data: [], error: null }),
    propertyIds.length ? supabase.from("properties").select("id, address").in("id", propertyIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const officeName = new Map(((agencies.data ?? []) as Array<{ id: string; name: string }>).map((a) => [a.id, a.name]));
  const address = new Map(((properties.data ?? []) as Array<{ id: string; address: string }>).map((p) => [p.id, p.address]));

  return readerWeekFrom(rows, now, (r) => ({
    office: officeName.get(r.agency_id) ?? "An office",
    listing: (r.property_id && address.get(r.property_id)) || "A listing since deleted",
  }));
}

/** The figures from the week's rows. Pure, for the tests. */
export function readerWeekFrom(
  rows: ReadRow[],
  now: Date,
  where: (row: ReadRow) => { office: string; listing: string },
): ReaderWeek {
  const byReader = new Map<string, { done: number; failed: number }>();
  const because = new Map<string, number>();
  for (const r of rows) {
    const counts = byReader.get(r.reader) ?? { done: 0, failed: 0 };
    counts.done += 1;
    if (r.outcome === "failed") {
      counts.failed += 1;
      because.set(r.why ?? "other", (because.get(r.why ?? "other") ?? 0) + 1);
    }
    byReader.set(r.reader, counts);
  }
  return {
    weekTo: sydneyDate(new Date(now.getTime() - 24 * 3600_000)),
    done: rows.length,
    failed: rows.filter((r) => r.outcome === "failed").length,
    byReader: [...byReader.entries()]
      .map(([reader, c]) => ({ reader, ...c }))
      .sort((a, b) => b.done - a.done || a.reader.localeCompare(b.reader)),
    failedBecause: [...because.entries()].map(([why, n]) => ({ why, n })).sort((a, b) => b.n - a.n),
    zeroComparables: rows
      .filter((r) => r.reader === "comparable_sales" && r.outcome !== "failed" && (r.sales ?? 0) === 0)
      .map((r) => ({ ...where(r), at: r.read_at })),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function readerWeekEmail(week: ReaderWeek, { test = false }: { test?: boolean } = {}): {
  subject: string;
  doc: EmailDocument;
} {
  const weekTo = formatAuDate(week.weekTo);
  const sections: EmailSection[] = [
    { kind: "counter", n: week.done, caption: `${week.done === 1 ? "document read" : "documents read"} in the 7 days to ${weekTo}`, tone: "good" },
    {
      kind: "counter",
      n: week.failed,
      caption: `${week.failed === 1 ? "read" : "reads"} failed. Each was said on its card and emailed to you the same day`,
      tone: week.failed > 0 ? "warn" : "good",
    },
    {
      kind: "counter",
      n: week.zeroComparables.length,
      caption: `comparable-sales ${week.zeroComparables.length === 1 ? "report" : "reports"} gave 0 comparables`,
      tone: week.zeroComparables.length > 0 ? "warn" : "good",
    },
  ];

  if (week.byReader.length > 0) {
    sections.push({ kind: "label", text: "Reads by kind of document" });
    sections.push({
      kind: "rows",
      rows: week.byReader.map(
        (r): EmailRow => ({
          title: readerLabel(r.reader),
          sub: `${plural(r.done, "read")}${r.failed ? `, ${r.failed} failed` : ""}`,
          tone: r.failed ? "attention" : "routine",
        }),
      ),
    });
  }
  if (week.failedBecause.length > 0) {
    sections.push({ kind: "label", text: "Why reads failed" });
    sections.push({
      kind: "rows",
      rows: week.failedBecause.map((f) => ({
        title: WHY_LABELS[f.why as ReadFailureWhy] ?? f.why,
        sub: plural(f.n, "read"),
        tone: f.why === "cut_off" || f.why === "unparseable" ? "risk" : "attention",
      })),
    });
  }
  if (week.zeroComparables.length > 0) {
    sections.push({ kind: "label", text: "Comparable-sales reports with 0 comparables" });
    sections.push({
      kind: "rows",
      rows: week.zeroComparables.map((z) => ({
        title: z.listing,
        sub: `${z.office}, read ${formatAuDate(sydneyDate(new Date(z.at)))}`,
        tone: "attention",
      })),
    });
  }
  if (week.done === 0) {
    sections.push({ kind: "paragraph", text: "No documents were read this week." });
  }

  return {
    subject: `${test ? "[Test] " : ""}RealComply staff: document reads, week to ${weekTo}`,
    doc: {
      preheader: `${plural(week.done, "read")}, ${week.failed} failed, ${plural(week.zeroComparables.length, "report")} with 0 comparables`,
      title: "Document reads this week",
      meta: `RealComply staff email · 7 days to ${weekTo}`,
      sections,
      footer: [
        "RealComply staff email, sent to you each Monday morning with the weekly digest. Not sent to any office.",
        "From the record of reads. The daily reader check reports to Healthchecks as reader-check.",
      ],
    },
  };
}

/** The week's reads, made up, for the staff page's test. */
export function exampleReaderWeek(now: Date): ReaderWeek {
  return {
    weekTo: sydneyDate(new Date(now.getTime() - 24 * 3600_000)),
    done: 42,
    failed: 2,
    byReader: [
      { reader: "comparable_sales", done: 12, failed: 1 },
      { reader: "contract", done: 11, failed: 0 },
      { reader: "agency_agreement", done: 10, failed: 0 },
      { reader: "cpd_certificate", done: 6, failed: 1 },
      { reader: "licence", done: 3, failed: 0 },
    ],
    failedBecause: [
      { why: "cut_off", n: 1 },
      { why: "service", n: 1 },
    ],
    zeroComparables: [
      {
        office: "Sample Realty (made up)",
        listing: "12 Sample Street, Testville NSW 2999",
        at: new Date(now.getTime() - 3 * 24 * 3600_000).toISOString(),
      },
    ],
  };
}

/** Monday's staff email. True when sent (or nothing to send to); false when it couldn't be sent. */
export async function sendReaderWeek(supabase: Db, now: Date): Promise<boolean> {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) {
    console.error("weekly staff email not sent: ADMIN_NOTIFICATION_EMAIL is not set.");
    return true;
  }
  const week = await loadReaderWeek(supabase, now);
  const { subject, doc } = readerWeekEmail(week);
  return sendEmail({ to, subject, text: renderEmailText(doc), html: renderEmailHtml(doc) });
}
