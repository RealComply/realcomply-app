import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import {
  DAMAGED_FILE_MESSAGE,
  EMPTY_FILE_MESSAGE,
  chosenFileProblem,
  downloadedFileProblem,
  fileCutShort,
  fileReadsEmpty,
  type ReadAt,
} from "./file-check";
import { checkedPdf, generatedPdfProblem } from "@/lib/pdf/checked-pdf";
import {
  EVIDENCE_BUCKET,
  evidenceFileProblem,
  storedFileProblem,
  storedFileSize,
  uploadErrorMessage,
  uploadEvidenceObject,
} from "./evidence";

// Empty files are refused on every upload (Adam, 19 Oct 2026). Found on a live
// listing: two PDFs saved as 0-byte files and taken as done.

describe("the message", () => {
  it("is Adam's wording, word for word, with no em dash", () => {
    assert.equal(
      EMPTY_FILE_MESSAGE,
      "This file came through empty. You may be trying to upload a file stored in a cloud-based location. Download it to your computer, check it opens, then upload it again.",
    );
    assert.ok(!EMPTY_FILE_MESSAGE.includes("—"));
  });
});

describe("on screen, when the file is chosen", () => {
  it("a 0-byte file of an accepted type is refused with the message", () => {
    assert.equal(evidenceFileProblem({ name: "Market Appraisal.pdf", type: "application/pdf", size: 0 }), EMPTY_FILE_MESSAGE);
    assert.equal(evidenceFileProblem({ name: "offer.msg", type: "", size: 0 }), EMPTY_FILE_MESSAGE);
  });

  it("a one-byte file is not empty", () => {
    assert.equal(evidenceFileProblem({ name: "agreement.pdf", type: "application/pdf", size: 1 }), null);
  });

  it("reads the first byte, so a file whose size says one thing and whose bytes another is caught", async () => {
    assert.equal(await fileReadsEmpty(new Blob([])), true);
    assert.equal(await fileReadsEmpty(new Blob(["%PDF-1.7"])), false);

    // A file still in a cloud drive: it reports a size, then hands over nothing.
    const placeholder = { size: 52_000, slice: () => new Blob([]) } as unknown as Blob;
    assert.equal(await fileReadsEmpty(placeholder), true);

    // One the browser cannot read at all.
    const unreadable = {
      size: 52_000,
      slice: () => ({ arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }),
    } as unknown as Blob;
    assert.equal(await fileReadsEmpty(unreadable), true);
  });
});

describe("Storage's own refusal (0082)", () => {
  it("is said in Adam's words, not as a database error", async () => {
    const client = {
      storage: {
        from: () => ({ upload: async () => ({ error: { message: "database error, code: P0001" } }) }),
      },
    } as unknown as SupabaseClient;
    const { error } = await uploadEvidenceObject(client, { path: "ag/p1/a3/1-x.pdf", file: new File([await realPdf()], "a.pdf", { type: "application/pdf" }) });
    assert.equal(error, EMPTY_FILE_MESSAGE);
    assert.equal(uploadErrorMessage("new row violates row-level security policy"), "new row violates row-level security policy");
  });
});

describe("before the upload", () => {
  it("nothing empty is sent to Storage", async () => {
    let uploads = 0;
    const client = {
      storage: { from: () => ({ upload: async () => ((uploads += 1), { error: null }) }) },
    } as unknown as SupabaseClient;
    const empty = new File([], "Exclusive Sales Agreement.pdf", { type: "application/pdf" });

    const { error } = await uploadEvidenceObject(client, { path: "ag/p1/a3/1-x.pdf", file: empty });

    assert.equal(error, EMPTY_FILE_MESSAGE);
    assert.equal(uploads, 0);
  });
});

// Storage as the server asks it: info() first, the folder listing if info
// does not answer.
function storage(opts: {
  info?: { data: unknown; error: unknown } | "throws";
  list?: { data: unknown; error: unknown };
}) {
  const asked: string[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        assert.equal(bucket, EVIDENCE_BUCKET);
        return {
          async info(path: string) {
            asked.push(`info ${path}`);
            if (opts.info === "throws") throw new Error("network");
            return opts.info ?? { data: null, error: { message: "not found" } };
          },
          async list(folder: string, { search }: { search: string }) {
            asked.push(`list ${folder} ${search}`);
            return opts.list ?? { data: [], error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("on the server, by the size Storage holds", () => {
  const PATH = "ag/p1/a4/1791954642399-Market_Appraisal.pdf";

  it("refuses a stored file of 0 bytes, whatever the browser said", async () => {
    const { client } = storage({ info: { data: { size: 0 }, error: null } });
    assert.equal(await storedFileProblem(client, PATH), EMPTY_FILE_MESSAGE);
  });

  it("accepts a file with something in it", async () => {
    const { client } = storage({ info: { data: { size: 2_976_040 }, error: null } });
    assert.equal(await storedFileProblem(client, PATH), null);
  });

  it("reads the size from the folder listing when info does not answer", async () => {
    const { client, asked } = storage({
      info: "throws",
      list: { data: [{ name: "1791954642399-Market_Appraisal.pdf", metadata: { size: 0 } }], error: null },
    });
    assert.equal(await storedFileSize(client, PATH), 0);
    assert.deepEqual(asked, [`info ${PATH}`, "list ag/p1/a4 1791954642399-Market_Appraisal.pdf"]);
  });

  it("only the file itself counts in the listing, not one whose name starts the same", async () => {
    const { client } = storage({
      list: { data: [{ name: "1791954642399-Market_Appraisal.pdf.bak", metadata: { size: 0 } }], error: null },
    });
    assert.equal(await storedFileSize(client, PATH), null);
  });

  it("lets the file through when Storage cannot say, so a slow answer never stops a real upload", async () => {
    const { client } = storage({ info: "throws", list: { data: null, error: { message: "timeout" } } });
    assert.equal(await storedFileProblem(client, PATH), null);
  });
});

// Every server action that records an uploaded file asks Storage its size
// first. A new one added later should be added here, and to the check.
describe("every server action that records an upload asks the size", () => {
  const CHECKED: Array<[file: string, fn: string]> = [
    ["src/lib/actions/compliance.ts", "uploadEvidence"],
    ["src/lib/actions/compliance.ts", "addReportEntry"],
    ["src/lib/actions/properties.ts", "createProperty"],
    ["src/lib/actions/licences.ts", "attachLicenceDocument"],
    ["src/lib/actions/licences.ts", "attachCorporationLicenceDocument"],
    ["src/lib/actions/insurance.ts", "attachInsuranceCertificate"],
    ["src/lib/actions/insurance.ts", "addOtherInsurance"],
    ["src/lib/actions/insurance.ts", "attachOtherInsuranceCertificate"],
    ["src/lib/actions/registers.ts", "attachCpdCertificate"],
    ["src/lib/actions/registers.ts", "addCpdFromCertificate"],
    ["src/lib/actions/registers.ts", "finalizeCpdEvidence"],
    ["src/lib/actions/registers.ts", "addSgManualVersion"],
    ["src/lib/actions/signoffs.ts", "createSignoffDocument"],
    ["src/lib/actions/signoffs.ts", "replaceSignoffDocument"],
    ["src/lib/actions/trust-account.ts", "saveTrustAudit"],
    ["src/lib/actions/training-plans.ts", "attachPlanItemDocument"],
    ["src/lib/actions/agent-acknowledgement.ts", "recordSignedAnnexure"],
    ["src/lib/actions/team.ts", "saveAgencyLogo"],
    ["src/lib/storage/evidence.ts", "finalizeEvidenceRecord"],
  ];

  /** The text of one exported function, up to the next top-level declaration. */
  function body(file: string, fn: string): string {
    const source = readFileSync(file, "utf8");
    const start = source.indexOf(`export async function ${fn}(`);
    assert.ok(start >= 0, `${fn} not found in ${file}`);
    const rest = source.slice(start + 1);
    const end = rest.search(/\n(export |async function |function |const |type )/);
    return end < 0 ? rest : rest.slice(0, end);
  }

  for (const [file, fn] of CHECKED) {
    it(fn, () => {
      assert.match(body(file, fn), /storedFileProblem|refuseEmpty/, `${fn} saves an upload without asking its size`);
    });
  }
});

// ── Damaged files (Adam, 19 Oct 2026: "let's not leave these potential gaps") ──

const enc = (s: string) => new TextEncoder().encode(s);
const join = (...parts: Array<Uint8Array | number[]>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const reader = (b: Uint8Array): ReadAt => async (offset, length) => b.slice(offset, offset + length);
const cut = (b: Uint8Array, keep: number) => new Uint8Array(b.slice(0, Math.floor(b.length * keep)));
const checks = (name: string, b: Uint8Array) => fileCutShort({ name, type: "", size: b.length }, reader(b));

async function realPdf(pages = 3): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return new Uint8Array(await doc.save());
}

// A 1 x 1 PNG, as an image program writes it.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

// A JPEG laid out as a phone writes one: a thumbnail inside its first part
// (with its own end marker), the picture, the end marker, then a video after
// it as some phones add.
function phoneJpeg(): Uint8Array {
  const thumbnail = [0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x01, 0x02, 0xff, 0xd9];
  const exif = join(enc("Exif\0\0"), thumbnail);
  const app1 = join([0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff], exif);
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  const scan = join(new Uint8Array(4000).fill(0x55), [0xff, 0x00, 0x12, 0xff, 0xd3, 0x34], new Uint8Array(4000).fill(0x66));
  const video = join(enc("....ftypmp42"), new Uint8Array(30_000).fill(0x77));
  return join([0xff, 0xd8], app1, sos, scan, [0xff, 0xd9], video);
}

// A HEIC as a phone writes one: boxes, each saying how long it is.
function box(type: string, body: number): Uint8Array {
  const b = new Uint8Array(8 + body);
  new DataView(b.buffer).setUint32(0, 8 + body);
  b.set(enc(type), 4);
  return b;
}
const HEIC = join(box("ftyp", 16), box("meta", 400), box("mdat", 20_000));

// A Word file in the new format: a zip, ending with its table of contents.
// One with another document inside it, whose own table of contents sits
// further up.
function zip(inner = false): Uint8Array {
  const end = (comment = 0) => {
    const e = new Uint8Array(22 + comment);
    e.set([0x50, 0x4b, 0x05, 0x06]);
    new DataView(e.buffer).setUint16(20, comment, true);
    return e;
  };
  const embedded = inner ? join([0x50, 0x4b, 0x03, 0x04], new Uint8Array(500), end()) : new Uint8Array(0);
  return join([0x50, 0x4b, 0x03, 0x04], new Uint8Array(3000).fill(7), embedded, new Uint8Array(3000).fill(8), [0x50, 0x4b, 0x01, 0x02], new Uint8Array(60), end(4));
}

// A Word file in the old format: 512-byte blocks and a map of those in use.
function ole(): Uint8Array {
  const b = new Uint8Array(512 * 4);
  const d = new DataView(b.buffer);
  b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  d.setUint16(30, 9, true); // 512-byte blocks
  d.setUint32(44, 1, true); // one block of map
  d.setUint32(48, 1, true); // the contents list is block 1
  for (let i = 0; i < 109; i++) d.setUint32(76 + i * 4, 0xffffffff, true);
  d.setUint32(76, 0, true); // the map is block 0
  for (let i = 0; i < 128; i++) d.setUint32(512 + i * 4, 0xffffffff, true);
  d.setUint32(512, 0xfffffffd, true); // block 0: the map
  d.setUint32(516, 0xfffffffe, true); // block 1: the contents list
  d.setUint32(520, 0xfffffffe, true); // block 2: the document
  return b;
}

describe("a file that will not open (on screen, before sending, and on the server)", () => {
  it("the message, with no em dash", () => {
    assert.match(DAMAGED_FILE_MESSAGE, /^This file didn't come through whole, so it can't be opened\./);
    assert.ok(!DAMAGED_FILE_MESSAGE.includes("—"));
  });

  it("PDF: a whole one opens; one cut short, or a web page saved as .pdf, does not", async () => {
    const pdf = await realPdf();
    assert.equal(await checks("Market Appraisal.pdf", pdf), false);
    for (const keep of [0.5, 0.9, 0.99]) assert.equal(await checks("Market Appraisal.pdf", cut(pdf, keep)), true, String(keep));
    assert.equal(await checks("Market Appraisal.pdf", enc("<!doctype html><title>Sign in</title>")), true);
  });

  it("PNG: whole opens; cut short does not", async () => {
    assert.equal(await checks("photo.png", PNG), false);
    assert.equal(await checks("photo.png", cut(PNG, 0.9)), true);
  });

  it("JPEG: walked to the picture's own end, so a thumbnail's end marker and a video after it change nothing", async () => {
    const jpeg = phoneJpeg();
    assert.equal(await checks("IMG_0001.jpg", jpeg), false);
    // Cut inside the picture: the thumbnail's end marker is still there, and is not taken for the picture's.
    assert.equal(await checks("IMG_0001.jpg", jpeg.slice(0, 3000)), true);
    assert.equal(await checks("IMG_0001.jpg", cut(jpeg, 0.9)), false, "the picture is whole; only the video after it was cut");
  });

  it("HEIC: whole opens; cut short does not", async () => {
    assert.equal(await checks("IMG_0002.HEIC", HEIC), false);
    assert.equal(await checks("IMG_0002.HEIC", cut(HEIC, 0.9)), true);
  });

  it("Word and Excel, new format: the table of contents is looked for at the very end, not inside a picture or document within", async () => {
    assert.equal(await checks("Agency agreement.docx", zip()), false);
    assert.equal(await checks("Agency agreement.docx", cut(zip(), 0.99)), true);
    assert.equal(await checks("Comparables.xlsx", zip(true)), false);
    assert.equal(await checks("Comparables.xlsx", cut(zip(true), 0.7)), true, "an embedded file's end is not the file's end");
  });

  it("Word, Excel and Outlook, old format: every block the map says is in use is there", async () => {
    assert.equal(await checks("Contract.doc", ole()), false);
    assert.equal(await checks("Contract.doc", ole().slice(0, 1800)), true);
    assert.equal(await checks("Offer from buyer.msg", ole().slice(0, 1100)), true);
  });

  it("lenient where the programs are: an old .doc saved as .docx, a PNG saved as .jpg, a CRM export that is really text", async () => {
    assert.equal(await checks("Agreement.docx", ole()), false);
    assert.equal(await checks("photo.jpg", PNG), false);
    assert.equal(await checks("Buyers export.xls", enc("<html><table><tr><td>Pat Buyer (made up)</td></tr></table></html>")), false);
    assert.equal(await checks("Buyers export.xls", enc("Name,Phone\nPat Buyer (made up),0400 000 000\n")), false);
    assert.equal(await checks("Notes.doc", enc("{\\rtf1\\ansi Notes}")), false);
    assert.equal(await checks("Ledger.xls", Uint8Array.from([0x09, 0x04, 0x06, 0x00, 0, 0, 0x10, 0])), false, "Excel 4");
  });

  it("refuses a file that is none of what its name says", async () => {
    assert.equal(await checks("Agreement.docx", Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x00])), true);
    assert.equal(await checks("photo.jpg", Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x01])), true);
  });

  it("a saved email has nothing to check but that it is not empty", async () => {
    assert.equal(await checks("offer.eml", enc("From: a@example.test\r\n\r\nHello")), false);
  });

  it("on screen: the chosen file gets the right message", async () => {
    const pdf = await realPdf();
    assert.equal(await chosenFileProblem(new File([pdf], "Exclusive Sales Agreement.pdf", { type: "application/pdf" })), null);
    assert.equal(
      await chosenFileProblem(new File([cut(pdf, 0.9)], "Exclusive Sales Agreement.pdf", { type: "application/pdf" })),
      DAMAGED_FILE_MESSAGE,
    );
    assert.equal(await chosenFileProblem(new File([], "Exclusive Sales Agreement.pdf", { type: "application/pdf" })), EMPTY_FILE_MESSAGE);
  });

  it("before sending: nothing damaged is sent to Storage", async () => {
    let uploads = 0;
    const client = {
      storage: { from: () => ({ upload: async () => ((uploads += 1), { error: null }) }) },
    } as unknown as SupabaseClient;
    const half = new File([cut(await realPdf(), 0.5)], "Market Appraisal.pdf", { type: "application/pdf" });
    const { error } = await uploadEvidenceObject(client, { path: "ag/p1/a4/1-x.pdf", file: half });
    assert.equal(error, DAMAGED_FILE_MESSAGE);
    assert.equal(uploads, 0);
  });

  it("a document read on the server says which", async () => {
    assert.equal(await downloadedFileProblem(new Blob([]), "a.pdf"), EMPTY_FILE_MESSAGE);
    assert.equal(await downloadedFileProblem(new Blob([cut(await realPdf(), 0.9)]), "a.pdf"), DAMAGED_FILE_MESSAGE);
    assert.equal(await downloadedFileProblem(new Blob([await realPdf()]), "a.pdf"), null);
  });
});

describe("on the server, by reading the start and end of what Storage holds", () => {
  const PATH = "ag/p1/a3/1791954641747-Exclusive_Sales_Agreement.pdf";
  const SIGNED = "https://db.test/storage/v1/object/sign/compliance-evidence/x?token=t";

  function stored(bytes: Uint8Array<ArrayBuffer>, opts: { range?: boolean } = {}) {
    const ranges: string[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(input), SIGNED);
      const range = new Headers(init?.headers).get("Range") ?? "";
      ranges.push(range);
      if (opts.range === false) return new Response(new Blob([bytes]), { status: 200, headers: { "content-length": String(bytes.length) } });
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return new Response(new Blob([bytes.slice(Number(a), Number(b) + 1)]), { status: 206 });
    });
    const client = {
      storage: {
        from: () => ({
          info: async () => ({ data: { size: bytes.length, contentType: "application/pdf" }, error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: SIGNED }, error: null }),
        }),
      },
    } as unknown as SupabaseClient;
    return { client, ranges };
  }

  afterEach(() => mock.restoreAll());

  it("refuses a stored PDF that was cut short, reading only its start and end", async () => {
    const pdf = await realPdf();
    const { client, ranges } = stored(cut(pdf, 0.9));
    assert.equal(await storedFileProblem(client, PATH), DAMAGED_FILE_MESSAGE);
    assert.equal(ranges.length, 2, "two small reads, not the whole file");
  });

  it("accepts a whole one", async () => {
    const { client } = stored(await realPdf());
    assert.equal(await storedFileProblem(client, PATH), null);
  });

  it("lets a large file through when Storage will not read part of it, rather than stop a real upload", async () => {
    const big = join(await realPdf(), new Uint8Array(3 * 1024 * 1024));
    const { client } = stored(big, { range: false });
    assert.equal(await storedFileProblem(client, PATH), null);
  });
});

describe("PDFs RealComply makes are checked before they leave the builder", () => {
  it("a sound one passes; empty, cut short or not a PDF is refused", async () => {
    const pdf = await realPdf(1);
    assert.equal(await generatedPdfProblem(pdf), null);
    assert.equal(await generatedPdfProblem(new Uint8Array(0)), "it came out empty");
    assert.equal(await generatedPdfProblem(cut(pdf, 0.9)), "it came out incomplete");
    assert.match((await generatedPdfProblem(join(enc("%PDF-1.7\n"), new Uint8Array(50), enc("\n%%EOF\n")))) ?? "", /does not open|no pages/);
  });

  it("checkedPdf hands on a sound one and throws on a broken one, naming the document", async () => {
    const pdf = await realPdf(1);
    assert.equal(await checkedPdf(pdf, "SG annexure"), pdf);
    await assert.rejects(checkedPdf(new Uint8Array(0), "SG annexure"), /SG annexure: it came out empty/);
  });
});
