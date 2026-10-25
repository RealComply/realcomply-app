import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from "pdf-lib";
import {
  READER_PART_MAX_BYTES,
  TOO_LARGE_TO_READ,
  isTooLargeError,
  mapWithLimit,
  mergeReads,
  partNote,
  splitPdfForReader,
} from "@/lib/documents/reader-parts";

const MB = 1024 * 1024;

/**
 * A made-up PDF whose pages each carry one image of the given size. The
 * image bytes are random, so nothing can shrink them by accident and a page
 * can be recognised again by its bytes.
 */
async function madeUpPdf(pageImageBytes: number[]): Promise<{ bytes: Uint8Array; images: Buffer[] }> {
  const doc = await PDFDocument.create();
  const images: Buffer[] = [];
  for (const size of pageImageBytes) {
    const data = randomBytes(size);
    images.push(data);
    const page = doc.addPage([595, 842]);
    const image = doc.context.register(
      doc.context.stream(data, {
        Type: "XObject",
        Subtype: "Image",
        Width: 1000,
        Height: Math.max(1, Math.floor(size / 1000)),
        ColorSpace: "DeviceGray",
        BitsPerComponent: 8,
      }),
    );
    page.node.setXObject(PDFName.of("Scan"), image);
  }
  return { bytes: await doc.save(), images };
}

/** The image bytes on each page of a PDF, in page order. */
async function pageImages(bytes: Uint8Array): Promise<Buffer[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const xobjects = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    return Buffer.from((xobjects.lookup(PDFName.of("Scan"), PDFStream) as PDFRawStream).getContents());
  });
}

test("a file under the limit goes to the reader exactly as uploaded, unopened", async () => {
  const { bytes } = await madeUpPdf([200_000, 200_000]);
  const split = await splitPdfForReader(bytes);
  assert.ok(split.ok);
  if (!split.ok) return;
  assert.equal(split.parts.length, 1);
  assert.equal(split.parts[0].bytes, bytes, "the same bytes, not a copy");
  assert.equal(partNote(split.parts[0]), null, "read whole: asked exactly as before");
});

test("a 45 MB PDF is split into parts under 20 MB, in page order, every page byte for byte the same", async () => {
  const sizes = Array.from({ length: 15 }, () => 3 * MB); // 15 pages of 3 MB scans: 45 MB
  const { bytes, images } = await madeUpPdf(sizes);
  assert.ok(bytes.length > 44 * MB);

  const split = await splitPdfForReader(bytes);
  assert.ok(split.ok);
  if (!split.ok) return;

  assert.ok(split.parts.length >= 3);
  let nextPage = 1;
  const seen: Buffer[] = [];
  for (const part of split.parts) {
    assert.ok(part.bytes.length <= READER_PART_MAX_BYTES, `part ${part.index} is ${part.bytes.length} bytes`);
    assert.equal(part.firstPage, nextPage, "no page skipped or repeated");
    assert.equal(part.totalPages, 15);
    assert.equal(part.count, split.parts.length);
    nextPage = part.lastPage + 1;
    seen.push(...(await pageImages(part.bytes)));
  }
  assert.equal(nextPage, 16, "every page is in a part");

  // No quality lost: each page's scan is the original's, byte for byte.
  assert.equal(seen.length, images.length);
  seen.forEach((img, i) => assert.ok(img.equals(images[i]), `page ${i + 1} changed`));
});

test("pages of very different weights: a heavy part is halved until each fits", async () => {
  // Small limits keep the test quick; the rule is the same at 20 MB.
  const { bytes, images } = await madeUpPdf([1.5 * MB, 0.1 * MB, 0.1 * MB, 1.6 * MB, 0.1 * MB, 0.1 * MB].map(Math.round));
  const split = await splitPdfForReader(bytes, { maxBytes: 2 * MB });
  assert.ok(split.ok);
  if (!split.ok) return;
  for (const part of split.parts) assert.ok(part.bytes.length <= 2 * MB);
  const seen = (await Promise.all(split.parts.map((p) => pageImages(p.bytes)))).flat();
  seen.forEach((img, i) => assert.ok(img.equals(images[i])));
});

test("no more than the page limit in a part", async () => {
  const { bytes } = await madeUpPdf(Array.from({ length: 30 }, () => 100_000));
  const split = await splitPdfForReader(bytes, { maxBytes: 2 * MB, maxPages: 5 });
  assert.ok(split.ok);
  if (!split.ok) return;
  assert.equal(split.parts.length, 6);
  for (const part of split.parts) assert.ok(part.lastPage - part.firstPage + 1 <= 5);
});

test("one page heavier than a part can be: can't be read, never shrunk", async () => {
  const { bytes } = await madeUpPdf([3 * MB, 100_000]);
  const split = await splitPdfForReader(bytes, { maxBytes: 2 * MB });
  assert.deepEqual(split, { ok: false });
});

test("a file that won't open to split: can't be read", async () => {
  const notAPdf = randomBytes(3 * MB);
  assert.deepEqual(await splitPdfForReader(notAPdf, { maxBytes: 2 * MB }), { ok: false });
});

test("each part is told which pages it is, and not to call anything missing", () => {
  const note = partNote({ index: 2, count: 3, firstPage: 41, lastPage: 80, totalPages: 120 });
  assert.match(note!, /^This is part 2 of 3 of one document: pages 41 to 80 of 120\./);
  assert.match(note!, /never describe anything as missing/);
  assert.doesNotMatch(note!, /—/);
});

test("the parts' answers as one: found anywhere is found, the first figure stated wins, notes kept once", () => {
  const merged = mergeReads<Record<string, unknown>>([
    {
      itemKey: "b1",
      note: "Section 10.7 certificate is dated 2025.",
      prescribedDocs: [
        { key: "s10_7", found: true },
        { key: "sewer_diagram", found: false },
        { key: "title_search", found: false },
      ],
      eventDate: "2026-10-01",
    },
    {
      itemKey: "b1",
      note: "Section 10.7 certificate is dated 2025.",
      prescribedDocs: [
        { key: "s10_7", found: false },
        { key: "sewer_diagram", found: true },
        { key: "title_search", found: false },
      ],
      eventDate: "2026-11-05",
      consumerGuideProvided: true,
    },
    { itemKey: "b1", note: "Drainage diagram is a copy.", consumerGuideProvided: false, espLow: "" },
  ]);
  assert.deepEqual(merged.prescribedDocs, [
    { key: "s10_7", found: true },
    { key: "sewer_diagram", found: true },
    { key: "title_search", found: false },
  ]);
  assert.equal(merged.eventDate, "2026-10-01", "the first part to state it");
  assert.equal(merged.consumerGuideProvided, true, "yes from any part stays yes");
  assert.equal(merged.note, "Section 10.7 certificate is dated 2025.\nDrainage diagram is a copy.");
  assert.equal("espLow" in merged, false, "a blank answer is no answer");
});

test("comparable sales across parts: each address once, its details combined", () => {
  const merged = mergeReads<Record<string, unknown>>([
    { comparableSales: [{ address: "1 Test St, Testville", salePrice: 900000 }], subjectProperty: { bedrooms: 3 } },
    {
      comparableSales: [
        { address: "1 test st testville", bedrooms: 3 },
        { address: "2 Made Up Rd, Testville", salePrice: 950000 },
      ],
      subjectProperty: { bedrooms: 4, bathrooms: 2 },
    },
  ]);
  assert.deepEqual(merged.comparableSales, [
    { address: "1 Test St, Testville", salePrice: 900000, bedrooms: 3 },
    { address: "2 Made Up Rd, Testville", salePrice: 950000 },
  ]);
  assert.deepEqual(merged.subjectProperty, { bedrooms: 3, bathrooms: 2 });
});

test("nothing read from any part: an empty answer", () => {
  assert.deepEqual(mergeReads([]), {});
});

test("the reader's size errors are recognised (and get plain words), other errors aren't", () => {
  // The error Uralla Properties saw on 24 Oct 2026, as the service sent it.
  const live = new Anthropic.BadRequestError(
    400,
    {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "messages.0.content.0.document.source.base64: PDF exceeds 32 MB maximum: 78086240 bytes > 33554432 bytes",
      },
    },
    undefined,
    new Headers(),
  );
  assert.equal(isTooLargeError(live), true);
  assert.equal(isTooLargeError(new Anthropic.APIError(413, { type: "error" }, "request_too_large", new Headers())), true);
  assert.equal(
    isTooLargeError(new Anthropic.BadRequestError(400, { message: "A maximum of 600 PDF pages may be provided." }, undefined, new Headers())),
    true,
  );
  assert.equal(isTooLargeError(new Anthropic.APIError(529, { type: "overloaded_error" }, "Overloaded", new Headers())), false);
  assert.equal(isTooLargeError(new Error("network")), false);

  assert.equal(TOO_LARGE_TO_READ, "This file is too large to read automatically, so enter the details yourself.");
  assert.doesNotMatch(TOO_LARGE_TO_READ, /32|MB|smaller|reduce|compress/i);
});

test("parts are read a few at a time, answers kept in page order", async () => {
  let running = 0;
  let most = 0;
  const out = await mapWithLimit([5, 1, 4, 2, 3], 3, async (n) => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, n * 5));
    running--;
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
  assert.equal(most, 3);
});
