import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTED_FILES,
  UPLOAD_A_PDF,
  cantReadMessage,
  savedButCantRead,
  unreadableKind,
} from "@/lib/storage/accepted-files";

// The approved words (Adam, 2 to 3 Nov 2026), word for word.

describe("the words", () => {
  it("says the accepted files line exactly", () => {
    assert.equal(ACCEPTED_FILES, "Accepted files: Clear photo or PDF.");
  });

  it("names the button exactly", () => {
    assert.equal(UPLOAD_A_PDF, "Upload a PDF");
  });

  it("says the notice exactly for each kind", () => {
    assert.equal(
      savedButCantRead("Word files"),
      "Saved, but we can't read Word files. Save it as a PDF and upload that, and we'll fill in the details for you.",
    );
    assert.equal(
      savedButCantRead("Excel files"),
      "Saved, but we can't read Excel files. Save it as a PDF and upload that, and we'll fill in the details for you.",
    );
    assert.equal(
      savedButCantRead("saved emails"),
      "Saved, but we can't read saved emails. Save it as a PDF and upload that, and we'll fill in the details for you.",
    );
  });

  it("uses no dashes and never the word compliant", () => {
    for (const text of [ACCEPTED_FILES, UPLOAD_A_PDF, ...(["Word files", "Excel files", "saved emails"] as const).map(savedButCantRead)]) {
      assert.doesNotMatch(text, /[\u2013\u2014]/);
      assert.doesNotMatch(text, /compliant/i);
    }
  });
});

describe("which files the reader can't open, by the name's extension", () => {
  it("knows each Word, Excel and saved email extension", () => {
    assert.equal(unreadableKind("Agency agreement.doc"), "Word files");
    assert.equal(unreadableKind("Agency agreement.docx"), "Word files");
    assert.equal(unreadableKind("Comparables.xls"), "Excel files");
    assert.equal(unreadableKind("Comparables.xlsx"), "Excel files");
    assert.equal(unreadableKind("Letter from the solicitor.eml"), "saved emails");
    assert.equal(unreadableKind("Letter from the solicitor.msg"), "saved emails");
  });

  it("ignores case", () => {
    assert.equal(unreadableKind("CONTRACT.DOCX"), "Word files");
    assert.equal(unreadableKind("Notice.Doc"), "Word files");
    assert.equal(unreadableKind("SALES.XLSX"), "Excel files");
    assert.equal(unreadableKind("Fwd.MSG"), "saved emails");
    assert.equal(unreadableKind("fwd.Eml"), "saved emails");
  });

  it("goes by the last extension when a name has several dots", () => {
    assert.equal(unreadableKind("12.3 Smith St v2.final.docx"), "Word files");
    assert.equal(unreadableKind("report.pdf.xlsx"), "Excel files");
    assert.equal(unreadableKind("letter.docx.pdf"), null);
    assert.equal(unreadableKind("photo.msg.jpg"), null);
  });

  it("reads a stored path by its file name", () => {
    assert.equal(unreadableKind("agency/property/a3/1730000000000-Agency_agreement.docx"), "Word files");
    assert.equal(unreadableKind("agency/_licences/person/1730000000000-licence.pdf"), null);
  });

  it("is null for a PDF or a photo", () => {
    for (const name of ["contract.pdf", "IMG_9352.jpg", "scan.jpeg", "notice.png", "IMG_9352.HEIC", "photo.heif", "NOTICE.PDF"]) {
      assert.equal(unreadableKind(name), null, name);
    }
  });

  it("is null with no name or no extension", () => {
    assert.equal(unreadableKind(null), null);
    assert.equal(unreadableKind(undefined), null);
    assert.equal(unreadableKind(""), null);
    assert.equal(unreadableKind("docx"), null);
    assert.equal(unreadableKind("contract."), null);
    assert.equal(unreadableKind("folder.docx/contract"), null);
  });
});

describe("the sentence for a stored file", () => {
  it("is the notice for a file the reader can't open", () => {
    assert.equal(
      cantReadMessage("Comparables.XLSX"),
      "Saved, but we can't read Excel files. Save it as a PDF and upload that, and we'll fill in the details for you.",
    );
  });

  it("is null for one it can", () => {
    assert.equal(cantReadMessage("Comparables.pdf"), null);
    assert.equal(cantReadMessage(null), null);
  });
});
