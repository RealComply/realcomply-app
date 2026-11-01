import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alertDue, noteRead, type ReaderAlert } from "@/lib/documents/read-record";
import { UnfinishedAnswer } from "@/lib/documents/reader-answer";
import { readerAlertEmail } from "@/lib/email/reader-alert";

// The record of reads and Adam's same-day alert (Adam, 1 Nov 2026). The
// database decides when an alert is due (supabase/tests/document_reads.sql);
// these check what the app sends it, and what it does with the answer.
// Made-up offices, listings and files only.

type Call = { fn: string; args: Record<string, unknown> };

/** A stand-in database: records each call, answers with `answer`. */
function stand(answer: { data: unknown; error: { message: string } | null } | Error) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    },
  };
}

/** Runs the alert straight away and keeps it, instead of emailing. */
function inbox() {
  const sent: ReaderAlert[] = [];
  return {
    sent,
    options: {
      send: async (a: ReaderAlert) => void sent.push(a),
      later: (task: () => Promise<unknown>) => void task(),
      now: () => new Date("2026-11-01T22:14:00Z"),
    },
  };
}

const LISTING = "00000000-0000-4000-8000-000000000001";
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("recording a read", () => {
  it("sends the database the reader, outcome, listing and sales, and no file name", async () => {
    const db = stand({ data: { alert: false }, error: null });
    const box = inbox();
    await noteRead(
      db.client,
      { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma-12-sample-st.pdf", propertyId: LISTING, outcome: "read", sales: 27 },
      box.options,
    );
    assert.deepEqual(db.calls, [
      {
        fn: "note_document_read",
        args: { p_reader: "comparable_sales", p_outcome: "read", p_why: null, p_property_id: LISTING, p_sales: 27 },
      },
    ]);
    assert.ok(!JSON.stringify(db.calls).includes("cma-12"), "the file's name stays in the app");
    await settle();
    assert.equal(box.sent.length, 0, "no alert when the database says none is due");
  });

  it("logs a failed read as an error, with why worked out from what was thrown", async (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    const db = stand({ data: { alert: false }, error: null });
    await noteRead(
      db.client,
      { reader: "contract", card: "Contract (b1)", fileName: "contract.pdf", propertyId: LISTING, outcome: "failed", error: new UnfinishedAnswer("cut_off") },
      inbox().options,
    );
    assert.equal(db.calls[0].args.p_why, "cut_off");
    assert.equal(logged[0][0], "document read failed: contract (cut_off)");
  });

  it("sends no sales for a reader that isn't the comparable-sales report", async () => {
    const db = stand({ data: { alert: false }, error: null });
    await noteRead(db.client, { reader: "licence", card: "Licence register", fileName: "licence.jpg", outcome: "read" }, inbox().options);
    assert.equal(db.calls[0].args.p_sales, null);
    assert.equal(db.calls[0].args.p_property_id, null);
  });
});

describe("Adam's alert", () => {
  it("is sent when the database says it is due, naming the office, listing, card and file", async () => {
    const db = stand({ data: { alert: true, office: "Sample Realty (made up)", listing: "12 Sample Street, Testville NSW 2999" }, error: null });
    const box = inbox();
    await noteRead(
      db.client,
      { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma-12-sample-st.pdf", propertyId: LISTING, outcome: "failed", why: "cut_off" },
      box.options,
    );
    await settle();
    assert.equal(box.sent.length, 1);
    const email = readerAlertEmail(box.sent[0]);
    for (const part of ["Sample Realty (made up)", "12 Sample Street, Testville NSW 2999", "Comparable sales (a4)", "cma-12-sample-st.pdf"]) {
      assert.ok(email.text.includes(part), `the alert names ${part}`);
    }
    assert.match(email.text, /hit its length limit and was cut off/);
    assert.match(email.subject, /comparable-sales report couldn't be read \(12 Sample Street/);
  });

  it("is sent for a comparable-sales report with 0 comparables", async () => {
    const db = stand({ data: { alert: true, office: "Sample Realty (made up)", listing: "3 Example Road, Testville NSW 2999" }, error: null });
    const box = inbox();
    await noteRead(
      db.client,
      { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma.pdf", propertyId: LISTING, outcome: "nothing_found", sales: 0 },
      box.options,
    );
    await settle();
    const email = readerAlertEmail(box.sent[0]);
    assert.match(email.subject, /gave 0 comparables \(3 Example Road/);
    assert.match(email.text, /no comparable sales were taken from the report/);
  });

  it("is never more than the database allows: one due, one sent", async () => {
    let due = true;
    const db = {
      rpc: () => {
        const answer = { data: { alert: due, office: "Sample Realty (made up)", listing: "1 Sample Street" }, error: null };
        due = false; // what the database does after the first claim of the day
        return Promise.resolve(answer);
      },
    };
    const box = inbox();
    for (let i = 0; i < 3; i++) {
      await noteRead(db, { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", propertyId: LISTING, outcome: "failed", why: "service" }, box.options);
    }
    await settle();
    assert.equal(box.sent.length, 1);
  });
});

describe("a record that can't be written", () => {
  it("is logged and never stops the read", async (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    const refused = stand({ data: null, error: { message: "function note_document_read does not exist" } });
    await noteRead(refused.client, { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", outcome: "read" }, inbox().options);
    const down = stand(new Error("fetch failed"));
    await noteRead(down.client, { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", outcome: "read" }, inbox().options);
    assert.equal(logged.length, 2);
    assert.equal(logged[0][0], "document read not recorded: contract");
  });

  it("an alert that can't be sent is logged too", async (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, "error", (...args: unknown[]) => logged.push(args));
    const db = stand({ data: { alert: true, office: "Sample Realty (made up)", listing: null }, error: null });
    await noteRead(
      db.client,
      { reader: "cpd_certificate", card: "CPD register", fileName: "cpd.pdf", outcome: "failed", why: "cut_off" },
      { send: async () => Promise.reject(new Error("SES refused")), later: (task) => void task() },
    );
    await settle();
    assert.ok(logged.some((l) => l[0] === "reader alert not sent: cpd_certificate"));
  });
});

// Closing the gap (Adam, 2 Nov 2026: "yes close the gap"). A read the database
// couldn't record used to send no alert at all, since the database decided.

/** A database that can't record anything, with the names it can (or can't) look up. */
function down(lookup: "works" | "fails" | "hangs" | "none") {
  const looked: string[] = [];
  const row = (table: string) =>
    table === "properties"
      ? { address: "12 Sample Street, Testville NSW 2999", agencies: { name: "Sample Realty (made up)" } }
      : { name: "Sample Realty (made up)" };
  const from = (table: string) => ({
    select: () => ({
      eq: (_column: string, value: string) => ({
        maybeSingle: () => {
          looked.push(`${table}:${value}`);
          if (lookup === "fails") return Promise.reject(new Error("fetch failed"));
          if (lookup === "hangs") return new Promise<never>(() => {});
          return Promise.resolve({ data: row(table) });
        },
      }),
    }),
  });
  return {
    looked,
    client: {
      rpc: () => Promise.resolve({ data: null, error: { message: "function public.note_document_read does not exist" } }),
      ...(lookup === "none" ? {} : { from }),
    },
  };
}

const listing = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const quiet = (t: { mock: { method: (o: object, m: string, f: () => void) => unknown } }) => t.mock.method(console, "error", () => {});

describe("a read the database can't record", () => {
  it("still sends the alert, naming the office and listing it could look up, and says it wasn't recorded", async (t) => {
    quiet(t);
    const db = down("works");
    const box = inbox();
    await noteRead(
      db.client,
      { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma.pdf", propertyId: listing(1), outcome: "failed", why: "cut_off" },
      box.options,
    );
    await settle();
    assert.equal(box.sent.length, 1);
    assert.equal(box.sent[0].office, "Sample Realty (made up)");
    assert.equal(box.sent[0].listing, "12 Sample Street, Testville NSW 2999");
    assert.equal(box.sent[0].unrecorded, "function public.note_document_read does not exist");
    const email = readerAlertEmail(box.sent[0]);
    assert.match(email.text, /Not recorded: the record of reads couldn't be written \(function public\.note_document_read does not exist\), so this email was sent anyway\./);
    assert.ok(!email.text.includes("This is the only email"), "no promise it's the only one");
  });

  it("still sends it when the names can't be looked up either", async (t) => {
    quiet(t);
    for (const [n, lookup] of [[2, "fails"], [3, "none"]] as const) {
      const box = inbox();
      await noteRead(down(lookup).client, { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", propertyId: listing(n), outcome: "failed", why: "service" }, box.options);
      await settle();
      assert.equal(box.sent.length, 1, lookup);
      assert.equal(box.sent[0].office, null);
      assert.equal(box.sent[0].listing, null);
      const email = readerAlertEmail(box.sent[0]);
      assert.equal(email.subject, "RealComply alert: a contract for sale couldn't be read (listing not known)");
      assert.ok(email.text.includes("Office: Not known (it couldn't be looked up)"));
      assert.ok(email.text.includes(`Listing: Not known (it couldn't be looked up; listing id ${listing(n)})`));
    }
  });

  it("never waits on a database that isn't answering: the names are given up after 3 seconds", async (t) => {
    quiet(t);
    const box = inbox();
    const started = Date.now();
    let done!: () => void;
    const finished = new Promise<void>((r) => (done = r));
    await noteRead(
      down("hangs").client,
      { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", propertyId: listing(4), outcome: "failed", why: "service" },
      { ...box.options, later: (task) => void task().then(done) },
    );
    await finished;
    assert.equal(box.sent.length, 1);
    assert.ok(Date.now() - started < 4500, "sent within about 3 seconds");
  });

  it("sends nothing for a good read, and alerts for a comparable-sales report with 0 comparables", async (t) => {
    quiet(t);
    const box = inbox();
    await noteRead(down("works").client, { reader: "contract", card: "Contract (b1)", fileName: "c.pdf", propertyId: listing(5), outcome: "read" }, box.options);
    await noteRead(down("works").client, { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma.pdf", propertyId: listing(6), outcome: "read", sales: 27 }, box.options);
    await settle();
    assert.equal(box.sent.length, 0);
    await noteRead(down("works").client, { reader: "comparable_sales", card: "Comparable sales (a4)", fileName: "cma.pdf", propertyId: listing(7), outcome: "nothing_found", sales: 0 }, box.options);
    await settle();
    assert.equal(box.sent.length, 1);
    assert.match(readerAlertEmail(box.sent[0]).subject, /gave 0 comparables/);
  });

  it("is emailed once a day per listing from each server, and again the next day", async (t) => {
    quiet(t);
    const box = inbox();
    const failure = (n: number) => ({ reader: "contract" as const, card: "Contract (b1)", fileName: "c.pdf", propertyId: listing(n), outcome: "failed" as const, why: "service" as const });
    await noteRead(down("works").client, failure(8), box.options);
    await noteRead(down("works").client, failure(8), box.options);
    await noteRead(down("works").client, failure(9), box.options);
    await settle();
    assert.equal(box.sent.length, 2, "one for each listing");
    const nextDay = { ...box.options, now: () => new Date("2026-11-02T22:14:00Z") };
    await noteRead(down("works").client, failure(8), nextDay);
    await settle();
    assert.equal(box.sent.length, 3, "a new day, a new email");
  });

  it("names the office for a read that isn't on a listing, once a day per office and kind of document", async (t) => {
    quiet(t);
    const db = down("works");
    const box = inbox();
    const cpd = { reader: "cpd_certificate" as const, card: "CPD register", fileName: "cpd.pdf", agencyId: "office-a", outcome: "failed" as const, why: "cut_off" as const };
    await noteRead(db.client, cpd, box.options);
    await noteRead(db.client, cpd, box.options);
    await noteRead(db.client, { ...cpd, reader: "licence", card: "Licence register" }, box.options);
    await settle();
    assert.equal(box.sent.length, 2);
    assert.equal(box.sent[0].office, "Sample Realty (made up)");
    assert.equal(box.sent[0].listing, null);
    assert.deepEqual(db.looked, ["agencies:office-a", "agencies:office-a"]);
  });
});

describe("whether a read needs an alert", () => {
  it("is the same rule as the database's: a failed read, or a comparable-sales report with no sales", () => {
    assert.equal(alertDue({ reader: "contract", outcome: "failed" }), true);
    assert.equal(alertDue({ reader: "cpd_certificate", outcome: "failed" }), true);
    assert.equal(alertDue({ reader: "comparable_sales", outcome: "read", sales: 0 }), true);
    assert.equal(alertDue({ reader: "comparable_sales", outcome: "nothing_found" }), true);
    assert.equal(alertDue({ reader: "comparable_sales", outcome: "wrong_document", sales: 0 }), true);
    assert.equal(alertDue({ reader: "comparable_sales", outcome: "read", sales: 27 }), false);
    assert.equal(alertDue({ reader: "contract", outcome: "nothing_found" }), false);
    assert.equal(alertDue({ reader: "id_screen", outcome: "read" }), false);
  });
});
