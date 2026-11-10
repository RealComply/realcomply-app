import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { UnfinishedAnswer } from "@/lib/documents/reader-answer";
import { DocxUnreadable, docxParagraphs, documentXmlParagraphs } from "@/lib/sg-document/docx";
import { pagesSaid, sgCheckLines, sgChecks, sgChecksOf, sgReadGapLines } from "@/lib/sg-document/checks";
import { SG_2_1_3_ACTS } from "@/lib/sg-document/fair-trading";
import { assembleSections, joinPieces, readPartOf, sectionHeading, versionOf, type ReadPartResult } from "@/lib/sg-document/sections";
import { openSgFile, partCount, readSgPart, SgFileUnreadable } from "@/lib/sg-document/read";
import { advanceSgRead, sgReadFailureText, type SgReadStore } from "@/lib/sg-document/advance";

// Supervision guidelines as a live document, part 1 (Adam's mockup, 6 Nov
// 2026; "go ahead with part 1", 10 Nov 2026). Made-up offices, people and
// documents throughout.

/** A zip of the given files (deflated), enough to stand in for a .docx. */
function zip(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const para = (text: string, style?: string, numbered = false) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numbered ? "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>" : ""}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const docx = (paragraphs: string[]) =>
  zip({
    "[Content_Types].xml": "<Types/>",
    "word/document.xml": `<?xml version="1.0"?><w:document><w:body>${paragraphs.join("")}</w:body></w:document>`,
  });

const MANUAL = docx([
  para("Harbour &amp; Vale Supervision Manual", "Title"),
  para("Version 7.3"),
  para("Introduction", "Heading1", true),
  para("This manual applies to Harbour &amp; Vale Realty Pty Ltd (made up). Priya Nair is the licensee in charge."),
  para(""),
  para("Trust money", "Heading1", true),
  // A tab between two runs of text, as Word writes it.
  para("4.1</w:t><w:tab/><w:t>Money is banked by the next business day."),
  para("4.2 Receipts are reconciled weekly."),
]);

describe("reading a Word document (.docx)", () => {
  it("gives each paragraph's words, whether it's a heading, and whether it's in Word's numbered list", () => {
    const out = docxParagraphs(MANUAL);
    assert.deepEqual(out.map((p) => p.text), [
      "Harbour & Vale Supervision Manual",
      "Version 7.3",
      "Introduction",
      "This manual applies to Harbour & Vale Realty Pty Ltd (made up). Priya Nair is the licensee in charge.",
      "Trust money",
      "4.1 Money is banked by the next business day.",
      "4.2 Receipts are reconciled weekly.",
    ]);
    assert.deepEqual(out.map((p) => p.heading), [true, false, true, false, true, false, false]);
    assert.equal(out[2].numbered, true);
    assert.equal(out[3].numbered, false);
  });

  it("reads every run of a paragraph in order, and character codes", () => {
    const [p] = documentXmlParagraphs('<w:p><w:r><w:t>Gifts </w:t></w:r><w:r><w:t>&#x2013; and benefits &#8217;</w:t></w:r><w:r><w:br/></w:r></w:p>');
    assert.equal(p.text, "Gifts – and benefits ’");
  });

  it("isn't fooled by a file that isn't a Word document", () => {
    assert.throws(() => docxParagraphs(new Uint8Array([1, 2, 3, 4])), DocxUnreadable);
    assert.throws(() => docxParagraphs(zip({ "other.xml": "<x/>" })), DocxUnreadable);
  });
});

describe("the 2.1.3 checks (flags only)", () => {
  const office = { businessNames: ["Harbour & Vale Realty", "Harbour and Vale Realty Pty Ltd"], licenseeNames: ["Priya Anne Nair"] };

  it("finds the agency business, with or without Pty Ltd, and the licensee by first and last name", () => {
    const c = sgChecks("These procedures apply to HARBOUR AND VALE REALTY. Licensee in charge: Priya Nair.", office);
    assert.equal(c.business.found, "Harbour & Vale Realty");
    assert.equal(c.licensee.found, "Priya Anne Nair");
  });

  it("says what it looked for when a name isn't there", () => {
    const c = sgChecks("A manual for some other office.", office);
    assert.equal(c.business.found, null);
    assert.equal(c.licensee.found, null);
    const lines = sgCheckLines(c);
    assert.equal(lines[0].ok, false);
    assert.match(lines[0].detail ?? "", /Not found: Harbour & Vale Realty or Harbour and Vale Realty Pty Ltd\. 2\.1\.3\(a\)/);
    assert.match(lines[1].detail ?? "", /Not found: Priya Anne Nair\. 2\.1\.3\(b\)/);
  });

  it("counts Fair Trading's 22 Acts, without their years, and names the ones not found", () => {
    assert.equal(SG_2_1_3_ACTS.length, 22);
    const text = [
      "Property and Stock Agents Act 2002 (NSW)", "Strata Schemes Management Act", "Strata Schemes Development Act 2015",
      "Community Land Management Act 2021", "Community Land Development Act", "Residential Tenancies Act 2010",
      "Conveyancing Act 1919", "Real Property Act", "Retail Leases Act 1994", "Swimming Pools Act",
      "Electronic Transactions Act 2000", "Uncollected Goods Act", "Work Health and Safety Act 2011",
      "Environmental Planning & Assessment Act 1979", "Design and Building Practitioners Act 2020",
      "the Australian Consumer Law", "Fair Trading Act 1987", "Anti‑Discrimination Act 1977", "Privacy Act 1988 (Cth)",
      "AML/CTF Act",
    ].join("; ");
    const c = sgChecks(text, office);
    assert.equal(c.acts.found.length, 20);
    assert.deepEqual(c.acts.missing, ["Prevention of Cruelty to Animals Act 1979", "Biosecurity Act 2015 (NSW and Commonwealth)"]);
    const [, , acts] = sgCheckLines(c);
    assert.equal(acts.text, "Lists the relevant laws: 20 of the 22 Acts on Fair Trading's minimum list");
    assert.equal(acts.detail, "Not found: Prevention of Cruelty to Animals Act 1979; Biosecurity Act 2015 (NSW and Commonwealth).");
  });

  it("doesn't count an Act from a longer name that only contains its words", () => {
    const c = sgChecks("The Residential Tenancies Amendment Act.", office);
    assert.ok(!c.acts.found.includes("Residential Tenancies Act 2010"));
  });

  it("reads back what was kept, and nothing from something else", () => {
    const c = sgChecks("Harbour & Vale Realty", office);
    assert.deepEqual(sgChecksOf(JSON.parse(JSON.stringify(c))), c);
    assert.equal(sgChecksOf({ business: 1 }), null);
  });
});

describe("putting the sections together", () => {
  const part = (paragraphs: ReadPartResult["paragraphs"], over: Partial<ReadPartResult> = {}): ReadPartResult => ({
    paragraphs,
    continues: false,
    version: null,
    ...over,
  });
  const h = (number: string | null, title: string) => ({ text: `${number ?? ""} ${title}`.trim(), section: { number, title } });
  const p = (text: string) => ({ text, section: null });

  it("one section a top-level heading, its own line the title, the cover first as Opening pages", () => {
    const sections = assembleSections([
      part([p("Harbour & Vale Supervision Manual"), p("Version 7.3"), h("1", "Introduction"), p("This manual applies.")], { version: "7.3" }),
      part([p("continued from the page before."), h("4", "Trust money"), p("4.1 Banked next day.")], { continues: true }),
    ]);
    assert.deepEqual(
      sections.map((s) => [s.position, sectionHeading(s), s.paragraphs]),
      [
        [0, "Opening pages", ["Harbour & Vale Supervision Manual", "Version 7.3"]],
        [1, "1. Introduction", ["This manual applies. continued from the page before."]],
        [2, "4. Trust money", ["4.1 Banked next day."]],
      ],
    );
  });

  it("no cover: starts at the first heading; no headings at all: the whole document", () => {
    assert.equal(assembleSections([part([h("1", "Introduction"), p("Words.")])])[0].title, "Introduction");
    const whole = assembleSections([part([p("Just words."), p("More words.")])]);
    assert.deepEqual(whole.map((s) => [s.title, s.paragraphs.length]), [["The whole document", 2]]);
  });

  it("the version is the first part that showed one", () => {
    assert.equal(versionOf([part([], { version: null }), part([], { version: "v7.3" })]), "v7.3");
  });

  it("keeps only what a part really holds", () => {
    assert.equal(readPartOf(null), null);
    const r = readPartOf({ paragraphs: [{ text: " x " }, { nope: 1 }, { text: "", section: { title: "Heading" } }], continues: true, version: " v2 " });
    assert.deepEqual(r, {
      paragraphs: [{ text: "x", section: null }, { text: "", section: { number: null, title: "Heading" } }],
      continues: true,
      version: "v2",
    });
  });
});

/** A PDF of blank pages, made up. */
async function pdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}

describe("reading a part", () => {
  it("a PDF: 4 pages at a time, told which pages, every paragraph written out", async () => {
    const file = await openSgFile(await pdf(6), "manual.pdf");
    assert.equal(partCount(file), 2);
    const asked: Array<{ note: string | null; tool: string; max: number; pages: number }> = [];
    const read = await readSgPart(file, 1, "manual.pdf", async (parts, q) => {
      const data = (parts[0].block as { source: { data: string } }).source.data;
      const pages = (await PDFDocument.load(Buffer.from(data, "base64"))).getPageCount();
      asked.push({ note: parts[0].note, tool: q.tool.name, max: q.maxTokens, pages });
      return [{ paragraphs: [{ text: "6. Complaints", section: { number: "6", title: "Complaints" } }, { text: "6.1 In writing." }], continues: true }];
    });
    assert.deepEqual(asked, [{ note: "These are pages 5 to 6 of 6, one part of the whole document.", tool: "pages_read", max: 16000, pages: 2 }]);
    assert.deepEqual(read.paragraphs.map((x) => [x.text, x.section?.title ?? null]), [["6. Complaints", "Complaints"], ["6.1 In writing.", null]]);
    assert.equal(read.continues, true);
  });

  it("a Word document: the reader only marks the headings; the words are Word's own", async () => {
    const file = await openSgFile(MANUAL, "manual.docx");
    assert.equal(partCount(file), 1);
    let sent = "";
    const read = await readSgPart(file, 0, "manual.docx", async (parts) => {
      sent = (parts[0].block as { text: string }).text;
      return [{ sections: [{ start: 2, number: "1", title: "Introduction" }, { start: 4, number: "4", title: "Trust money" }, { start: 99, title: "Not in this part" }], version: "7.3" }];
    });
    assert.match(sent, /\[2\] \(heading style, numbered\) Introduction/);
    assert.match(sent, /\[5\] 4\.1 Money is banked/);
    assert.equal(read.version, "7.3");
    assert.deepEqual(
      assembleSections([read]).map((s) => [sectionHeading(s), s.paragraphs.length]),
      [["Opening pages", 2], ["1. Introduction", 1], ["4. Trust money", 2]],
    );
  });

  it("a file that can't be opened says so in plain words", async () => {
    await assert.rejects(openSgFile(new Uint8Array([1, 2, 3]), "manual.pdf"), (e: unknown) => e instanceof SgFileUnreadable && /locked or damaged/.test(e.plain));
    await assert.rejects(openSgFile(new Uint8Array([1, 2, 3]), "manual.docx"), (e: unknown) => e instanceof SgFileUnreadable && /couldn't be opened/.test(e.plain));
    await assert.rejects(openSgFile(new Uint8Array([1]), "manual.doc"), (e: unknown) => e instanceof SgFileUnreadable);
  });
});

/** The database and storage, made up, recording what happened. */
function memoryStore(file: { bytes: Uint8Array; name: string }, held = false) {
  const state = {
    status: "reading" as string,
    parts: [] as unknown[],
    total: null as number | null,
    held,
    finished: null as null | Parameters<SgReadStore["finish"]>[2],
    failed: null as string | null,
    notes: [] as string[],
  };
  const store: SgReadStore = {
    async claim() {
      if (state.status !== "reading" || state.held) return null;
      state.held = true;
      return { id: "d1", agency_id: "o1", file_path: "o1/_sg-manual/1-x", file_name: file.name, read_parts: state.parts };
    },
    async progress() {
      return { status: "elsewhere", done: state.parts.filter(Boolean).length, total: state.total };
    },
    async download() {
      return { bytes: file.bytes };
    },
    async saveParts(_id, parts, total) {
      state.parts = JSON.parse(JSON.stringify(parts));
      state.total = total;
    },
    async release() {
      state.held = false;
    },
    async officeNames() {
      return { businessNames: ["Harbour & Vale Realty"], licenseeNames: ["Priya Nair"] };
    },
    async finish(_id, _agency, done) {
      state.status = "draft";
      state.finished = done;
    },
    async fail(_id, plain) {
      state.status = "read_failed";
      state.failed = plain;
    },
    async note(_agency, _file, outcome) {
      state.notes.push(outcome);
    },
  };
  return { store, state };
}

const pageAnswer = (title: string) => async () => [{ paragraphs: [{ text: title, section: { number: null, title } }, { text: "Made-up words for Harbour & Vale Realty and Priya Nair." }] }];

describe("moving a read along", () => {
  it("reads every part, keeps them, and leaves a draft with its sections and the 2.1.3 flags", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(9), name: "manual.pdf" });
    const progress = await advanceSgRead(store, "d1", { ask: pageAnswer("Complaints") });
    assert.deepEqual(progress, { status: "draft", done: 3, total: 3 });
    assert.equal(state.finished?.sections.length, 3);
    assert.equal(state.finished?.checks.business.found, "Harbour & Vale Realty");
    assert.equal(state.finished?.checks.licensee.found, "Priya Nair");
    assert.deepEqual(state.notes, ["read"]);
  });

  it("a few parts at a time: what's read is kept and the next call carries on", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(13), name: "manual.pdf" });
    let calls = 0;
    const ask = async () => {
      calls++;
      return [{ paragraphs: [{ text: "Words." }] }];
    };
    assert.deepEqual(await advanceSgRead(store, "d1", { ask, maxParts: 3 }), { status: "reading", done: 3, total: 4 });
    assert.equal(state.held, false);
    assert.deepEqual(await advanceSgRead(store, "d1", { ask }), { status: "draft", done: 4, total: 4 });
    assert.equal(calls, 4, "no part read twice");
  });

  it("the reader busy: nothing lost, nothing failed, still reading", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(4), name: "manual.pdf" });
    const progress = await advanceSgRead(store, "d1", {
      ask: async () => {
        throw new Anthropic.APIConnectionError({ message: "made up" });
      },
    });
    assert.equal(progress.status, "reading");
    assert.equal(state.status, "reading");
    assert.equal(state.held, false);
    assert.deepEqual(state.notes, []);
  });

  it("no page can be read at all, even one at a time: the read fails, in plain words, and is recorded", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(4), name: "manual.pdf" });
    let asked = 0;
    const progress = await advanceSgRead(store, "d1", {
      ask: async () => {
        asked++;
        throw new UnfinishedAnswer("cut_off");
      },
    });
    assert.equal(progress.status, "read_failed");
    assert.equal(state.failed, "None of its pages could be read. Try reading it again in a while, or upload the Word version.");
    assert.deepEqual(state.notes, ["failed"]);
    assert.equal(asked, 1 + 4 * 2, "the part, then each page twice");
  });

  it("someone else already reading it: says how far it is and reads nothing", async () => {
    const { store } = memoryStore({ bytes: await pdf(4), name: "manual.pdf" }, true);
    let asked = false;
    const progress = await advanceSgRead(store, "d1", {
      ask: async () => {
        asked = true;
        return [];
      },
    });
    assert.equal(progress.status, "elsewhere");
    assert.equal(asked, false);
  });

  it("every failure says what to do next, never the reader's own error", () => {
    assert.match(sgReadFailureText(new Error("socket hang up")), /Try reading it again in a minute/);
    assert.match(sgReadFailureText(new SgFileUnreadable("Upload a Word (.docx) or PDF file.")), /^Upload a Word/);
  });
});

// ── One bad part never fails the manual (Adam, 10 Nov 2026) ─────────────
//
// Global Property's 92-page manual (23 parts) stopped at part 7: the
// reader's answer for pages 25 to 28 came back unusable, the whole document
// was marked failed, and parts 10 to 23 were never read. Made-up pages here.

/** Which pages a question was about, from the note the reader is given. */
function pagesAsked(note: string | null): number[] {
  const one = /This is page (\d+) of/.exec(note ?? "");
  if (one) return [Number(one[1])];
  const range = /These are pages (\d+) to (\d+) of/.exec(note ?? "");
  if (!range) return [];
  return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
}

/**
 * A made-up reader: every page is "Page n words.", page 1 of each 8 a
 * heading. `bad` says how a question goes wrong: unusable for the pages it
 * names, or always for a page that can never be read.
 */
function pagesReader(opts: { wholePartFails?: (pages: number[]) => boolean; neverReads?: number[]; asked?: string[] } = {}) {
  return async (parts: Array<{ note: string | null }>) => {
    const pages = pagesAsked(parts[0].note);
    opts.asked?.push(pages.length === 1 ? `p${pages[0]}` : `p${pages[0]}-${pages[pages.length - 1]}`);
    if (pages.length > 1 && opts.wholePartFails?.(pages)) throw new UnfinishedAnswer("unparseable");
    if (pages.some((n) => opts.neverReads?.includes(n))) throw new UnfinishedAnswer("unparseable");
    return [
      {
        paragraphs: pages.flatMap((n) =>
          n % 8 === 1 ? [{ text: `Section ${n}`, section: { number: String(n), title: `Section ${n}` } }, { text: `Page ${n} words.` }] : [{ text: `Page ${n} words.` }],
        ),
      },
    ];
  };
}

describe("one part the reader can't answer never fails the manual", () => {
  it("Global's case: part 7's answer unusable, read again a page at a time, and the whole manual becomes a draft", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(92), name: "Procedures (made up).pdf" });
    const asked: string[] = [];
    const ask = pagesReader({ wholePartFails: (pages) => pages[0] === 25, asked });
    const progress = await advanceSgRead(store, "d1", { ask });
    assert.deepEqual(progress, { status: "draft", done: 23, total: 23 });
    // Every part asked; part 7 again as pages 25, 26, 27 and 28.
    for (const p of ["p1-4", "p21-24", "p25-28", "p25", "p26", "p27", "p28", "p29-32", "p89-92"]) assert.ok(asked.includes(p), p);
    const text = state.finished!.sections.flatMap((s) => s.paragraphs).join(" ");
    for (let n = 1; n <= 92; n++) assert.ok(text.includes(`Page ${n} words.`), `page ${n}`);
    assert.equal(state.finished!.sections.length, 12, "a section every 8 pages");
    assert.equal(state.finished!.checks.pages_not_read, undefined, "nothing left unread");
  });

  it("a page that still can't be read: named, tried twice, and the rest kept", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(92), name: "Procedures (made up).pdf" });
    const asked: string[] = [];
    const ask = pagesReader({ neverReads: [26], asked });
    const progress = await advanceSgRead(store, "d1", { ask });
    assert.equal(progress.status, "draft");
    assert.deepEqual(state.finished!.checks.pages_not_read, [26]);
    assert.equal(asked.filter((a) => a === "p26").length, 2, "page 26 tried twice on its own");
    const text = state.finished!.sections.flatMap((s) => s.paragraphs).join(" ");
    assert.ok(!text.includes("Page 26 words."));
    for (const n of [25, 27, 28, 29, 92]) assert.ok(text.includes(`Page ${n} words.`), `page ${n}`);
    assert.deepEqual(sgReadGapLines(state.finished!.checks), [
      "Page 26 of the file couldn't be read, so its words aren't in the sections here. Check that page in the file by hand.",
    ]);
    assert.deepEqual(state.notes, ["read"]);
  });

  it("something unexpected about one part: its pages named, every other part read", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(12), name: "manual.pdf" });
    const reader = pagesReader();
    const ask = async (parts: Array<{ note: string | null }>) => {
      if (pagesAsked(parts[0].note).includes(6)) throw new TypeError("made up");
      return reader(parts);
    };
    const quiet = console.error;
    console.error = () => {};
    try {
      const progress = await advanceSgRead(store, "d1", { ask: ask as never });
      assert.equal(progress.status, "draft");
    } finally {
      console.error = quiet;
    }
    assert.deepEqual(state.finished!.checks.pages_not_read, [6], "page 6 alone, after the part was tried a page at a time");
  });

  it("the reader busy part way: nothing lost, nothing failed, and the next call reads only what's left", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(36), name: "manual.pdf" });
    let busy = true;
    const asked: string[] = [];
    const reader = pagesReader({ asked });
    const ask = async (parts: Array<{ note: string | null }>) => {
      if (busy && pagesAsked(parts[0].note)[0] >= 13) throw new Anthropic.RateLimitError(429, undefined, "made up", new Headers());
      return reader(parts);
    };
    const first = await advanceSgRead(store, "d1", { ask: ask as never });
    assert.equal(first.status, "reading");
    assert.equal(state.status, "reading");
    assert.equal(state.held, false);
    assert.equal(first.done, 3, "parts 1 to 3 kept");
    busy = false;
    asked.length = 0;
    const second = await advanceSgRead(store, "d1", { ask: ask as never });
    assert.deepEqual(second, { status: "draft", done: 9, total: 9 });
    assert.ok(!asked.includes("p1-4") && !asked.includes("p9-12"), "parts already read aren't read again");
  });

  it("a read stopped part way (Global's: parts 1 to 6, 8 and 9 kept) carries on with only the parts not read", async () => {
    const { store, state } = memoryStore({ bytes: await pdf(92), name: "Procedures (made up).pdf" });
    const reader = pagesReader();
    const kept = await Promise.all(
      Array.from({ length: 23 }, async (_, i) =>
        i < 6 || i === 7 || i === 8 ? readPartOf((await reader([{ note: `These are pages ${i * 4 + 1} to ${i * 4 + 4} of 92` }]))[0]) : null,
      ),
    );
    state.parts = JSON.parse(JSON.stringify(kept));
    const asked: string[] = [];
    const progress = await advanceSgRead(store, "d1", { ask: pagesReader({ asked }) });
    assert.deepEqual(progress, { status: "draft", done: 23, total: 23 });
    assert.equal(asked.length, 15, "part 7 and parts 10 to 23 only");
    assert.ok(asked.includes("p25-28") && asked.includes("p37-40") && !asked.includes("p1-4") && !asked.includes("p29-32"));
  });

  it("a Word document: a stretch the reader can't answer is tried again in halves; the words are always kept", async () => {
    const file = await openSgFile(MANUAL, "manual.docx");
    let calls = 0;
    const read = await readSgPart(file, 0, "manual.docx", async () => {
      calls++;
      throw new UnfinishedAnswer("no_answer");
    });
    assert.equal(calls, 2, "a short document is tried twice");
    assert.equal(read.unmarked, 1);
    assert.ok(read.paragraphs.length > 0 && read.paragraphs.every((p) => p.section === null), "every word kept, no headings guessed");
    assert.deepEqual(sgReadGapLines({ ...sgChecksOf({ business: {}, licensee: {}, acts: {} })!, unmarked_stretches: 1 }), [
      "In one part of the document the headings couldn't be picked out, so those paragraphs sit under the section before them. Check the sections against the file.",
    ]);
  });
});

describe("saying which pages couldn't be read", () => {
  it("in ranges, in plain words", () => {
    assert.equal(pagesSaid([26]), "Page 26");
    assert.equal(pagesSaid([25, 26, 27, 28]), "Pages 25 to 28");
    assert.equal(pagesSaid([27, 26]), "Pages 26 and 27");
    assert.equal(pagesSaid([3, 4, 9]), "Pages 3, 4 and 9");
    assert.equal(pagesSaid([42, 25, 27, 40, 41]), "Pages 25, 27 and 40 to 42");
    assert.deepEqual(sgReadGapLines(null), []);
  });

  it("kept with the checks, and read back; nothing from something else", () => {
    const kept = { business: { found: null, looked_for: [] }, licensee: { found: null, looked_for: [] }, acts: { found: [], missing: [] }, pages_not_read: [25, 26, "x", -1] };
    assert.deepEqual(sgChecksOf(kept)?.pages_not_read, [25, 26]);
    assert.equal(sgChecksOf({ ...kept, pages_not_read: undefined })?.pages_not_read, undefined);
    assert.deepEqual(sgReadGapLines(sgChecksOf(kept)), [
      "Pages 25 and 26 of the file couldn't be read, so their words aren't in the sections here. Check those pages in the file by hand.",
    ]);
  });

  it("a part keeps which of its pages weren't read", () => {
    assert.deepEqual(readPartOf({ paragraphs: [{ text: "A." }], unreadPages: [26, 0, "x"] })?.unreadPages, [26]);
    assert.equal(readPartOf({ paragraphs: [] })?.unreadPages, undefined);
  });

  it("pages read one at a time are joined as one part; a sentence carries over, but never across a page not read", () => {
    const page = (text: string, continues = false): ReadPartResult => ({ paragraphs: [{ text, section: null }], continues, version: null });
    assert.deepEqual(joinPieces([page("Money is", false), page("banked daily.", true)]).paragraphs.map((p) => p.text), ["Money is banked daily."]);
    assert.deepEqual(joinPieces([page("Money is"), null, page("banked daily.", true)]).paragraphs.map((p) => p.text), ["Money is", "banked daily."]);
    assert.equal(joinPieces([page("A", true), page("B")]).continues, true);
  });
});
