import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_EVIDENCE_BYTES,
  TOO_LARGE_MESSAGE,
  WRONG_TYPE_MESSAGE,
  evidenceContentType,
  evidenceFileProblem,
} from "./evidence";

const MB = 1024 * 1024;
const f = (name: string, type: string, size = MB) => ({ name, type, size });

describe("evidenceFileProblem", () => {
  it("accepts every allowed type", () => {
    for (const file of [
      f("contract.pdf", "application/pdf"),
      f("photo.jpg", "image/jpeg"),
      f("photo.png", "image/png"),
      f("IMG_0001.HEIC", "image/heic"),
      f("notes.doc", "application/msword"),
      f("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
      f("ledger.xls", "application/vnd.ms-excel"),
      f("ledger.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      f("offer.eml", "message/rfc822"),
      f("offer.msg", "application/vnd.ms-outlook"),
    ]) {
      assert.equal(evidenceFileProblem(file), null, file.name);
    }
  });

  it("accepts saved emails the browser gives an empty or generic type, and stores them under the right one", () => {
    assert.equal(evidenceFileProblem(f("Offer from buyer.msg", "")), null);
    assert.equal(evidenceFileProblem(f("Offer from buyer.msg", "application/octet-stream")), null);
    assert.equal(evidenceFileProblem(f("offer.EML", "")), null);
    assert.equal(evidenceContentType(f("Offer from buyer.msg", "")), "application/vnd.ms-outlook");
    assert.equal(evidenceContentType(f("offer.eml", "application/octet-stream")), "message/rfc822");
  });

  it("refuses other types with the plain message", () => {
    for (const file of [
      f("photos.zip", "application/zip"),
      f("setup.exe", "application/x-msdownload"),
      f("picture.webp", "image/webp"),
      f("no-extension", ""),
    ]) {
      assert.equal(evidenceFileProblem(file), WRONG_TYPE_MESSAGE, file.name);
    }
  });

  it("allows 150 MB and refuses anything over it", () => {
    assert.equal(MAX_EVIDENCE_BYTES, 150 * MB);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 140 * MB)), null);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 150 * MB)), null);
    assert.equal(evidenceFileProblem(f("contract.pdf", "application/pdf", 160 * MB)), TOO_LARGE_MESSAGE);
  });
});
