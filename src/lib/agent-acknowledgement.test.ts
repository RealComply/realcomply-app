import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACK_INTRO,
  ACK_LABELS,
  ACK_STATEMENT_TEXTS,
  ACK_STATEMENTS,
  ACK_VERSION,
  HOME_CARD_TITLE,
  UPLOAD_HINT,
  ackProblem,
  homeCardText,
  listingGateFrom,
  lockCopy,
  lockedCreateMessage,
  signedAnnexureProblem,
} from "./agent-acknowledgement";

// Job 7 brief (14 Oct 2026): the "Before you start" wording, word for word;
// what stops "Confirm and continue"; the lock's messages by who is looking;
// and what the signed annexure upload accepts.

const MB = 1024 * 1024;

describe("Before you start: the words", () => {
  it("has the brief's intro and labels", () => {
    assert.equal(
      ACK_INTRO,
      "You're using RealComply on your own plan, so your agency's records are in your hands. Please confirm the following.",
    );
    assert.equal(ACK_LABELS.agentLicence, "Your licence or certificate number");
    assert.equal(ACK_LABELS.licenseeLicence, "Licensee's licence number");
    assert.equal(ACK_LABELS.button, "Confirm and continue");
    assert.equal(ACK_VERSION, "1.0");
  });

  it("has the five boxes exactly as briefed, with the Act's name (and only that) in italics", () => {
    assert.deepEqual(ACK_STATEMENT_TEXTS, [
      "I hold a current licence or certificate of registration under the Property and Stock Agents Act 2002 (NSW), and I work under the licensee in charge and at the agency named above.",
      "The records I put into RealComply, including information about vendors and purchasers, belong to my agency and its clients.",
      "My licensee in charge remains responsible for supervising my work. I understand RealComply supports that supervision and does not replace it.",
      "If I stop working at this agency I will tell RealComply, and I understand the agency may ask for its records and for my access to them to end.",
      "Before I add my first listing to RealComply, I will give my licensee in charge a copy of the RealComply Supervision Guidelines Annexure and have them complete and sign the section headed “Adoption by the licensee in charge”.",
    ]);
    const italic = ACK_STATEMENTS.flat().filter((r) => r.italic).map((r) => r.text);
    assert.deepEqual(italic, ["Property and Stock Agents Act 2002"]);
  });
});

describe("Confirm and continue", () => {
  const full = {
    agentLicenceNumber: "20456789",
    agencyName: "Harbourline Property Group",
    licenseeName: "Jordan Ellis",
    licenseeLicenceNumber: "10123456",
    typedName: "Sam Taylor",
  };
  const all = [true, true, true, true, true];

  it("is ready once every field is filled and every box ticked", () => {
    assert.equal(ackProblem(full, all), null);
  });

  it("stays grey with any field empty, including one of spaces", () => {
    for (const key of Object.keys(full) as Array<keyof typeof full>) {
      assert.equal(ackProblem({ ...full, [key]: "   " }, all), key === "typedName" ? "Fill in every field." : "Fill in every field.");
    }
  });

  it("stays grey with any box unticked", () => {
    for (let i = 0; i < 5; i++) {
      assert.equal(ackProblem(full, all.map((t, n) => (n === i ? false : t))), "Tick every box.");
    }
    assert.equal(ackProblem(full, [true, true, true, true]), "Tick every box.");
  });

  it("refuses a licence number that is too long", () => {
    assert.match(ackProblem({ ...full, agentLicenceNumber: "1".repeat(41) }, all) ?? "", /at most 40/);
  });
});

describe("The lock", () => {
  it("reads only the two reasons the database gives", () => {
    assert.equal(listingGateFrom("signed_annexure"), "signed_annexure");
    assert.equal(listingGateFrom("annexure"), "annexure");
    assert.equal(listingGateFrom(null), null);
    assert.equal(listingGateFrom("anything else"), null);
  });

  it("asks an agent on their own plan for the signed annexure, naming their licensee, with the upload", () => {
    const copy = lockCopy("signed_annexure", { actsAsLicensee: true }, "Jordan Ellis");
    assert.equal(copy.pill, "Waiting on the signed annexure");
    assert.equal(
      copy.text,
      "Upload the annexure signed by Jordan Ellis first, then you can add your first listing. Everything else in RealComply works as normal.",
    );
    assert.equal(copy.action, "upload");
  });

  it("gives someone assisting that agent the message without the upload", () => {
    assert.equal(lockCopy("signed_annexure", { actsAsLicensee: false }, "Jordan Ellis").action, null);
  });

  it("asks an office's licensee in charge to review and sign", () => {
    const copy = lockCopy("annexure", { actsAsLicensee: true }, "Jordan Ellis");
    assert.equal(copy.pill, "Waiting on the annexure");
    assert.equal(
      copy.text,
      "Adopt RealComply’s annexure to your Supervision Guidelines, then you can add listings. Everything else works as normal.",
    );
    assert.equal(copy.action, "review_and_sign");
  });

  it("tells an agent in that office who they are waiting on", () => {
    const copy = lockCopy("annexure", { actsAsLicensee: false }, "Jordan Ellis");
    assert.equal(
      copy.text,
      "Waiting on Jordan Ellis, your licensee in charge, to adopt RealComply’s annexure to your Supervision Guidelines. You can add listings once they have.",
    );
    assert.equal(copy.action, null);
    assert.match(lockCopy("annexure", { actsAsLicensee: false }, null).text, /^Waiting on your licensee in charge/);
  });

  it("says why when a new listing is refused", () => {
    assert.match(lockedCreateMessage("signed_annexure"), /^Waiting on the signed annexure/);
    assert.match(lockedCreateMessage("annexure"), /^Waiting on the annexure/);
  });
});

describe("The Home card and the upload", () => {
  it("has the brief's words", () => {
    assert.equal(HOME_CARD_TITLE, "Before your first listing: get your licensee’s sign-off");
    assert.equal(
      homeCardText("Jordan Ellis"),
      "Give this to Jordan Ellis and ask them to complete and sign the section headed “Adoption by the licensee in charge”. It explains how RealComply fits within your agency’s supervision system.",
    );
    assert.equal(UPLOAD_HINT, "PDF, JPG or PNG. A phone photo of the signed page is fine. Saved in Registers, Document sign-offs.");
  });

  it("takes a PDF, JPG or PNG, by type or by name", () => {
    assert.equal(signedAnnexureProblem({ name: "signed.pdf", type: "application/pdf", size: MB }, 150 * MB), null);
    assert.equal(signedAnnexureProblem({ name: "IMG_1234.JPG", type: "", size: MB }, 150 * MB), null);
    assert.equal(signedAnnexureProblem({ name: "photo", type: "image/png", size: MB }, 150 * MB), null);
  });

  it("refuses anything else, an empty file, and one over the limit", () => {
    assert.equal(
      signedAnnexureProblem({ name: "signed.docx", type: "application/msword", size: MB }, 150 * MB),
      "Upload a PDF, JPG or PNG.",
    );
    assert.equal(signedAnnexureProblem({ name: "photo.heic", type: "image/heic", size: MB }, 150 * MB), "Upload a PDF, JPG or PNG.");
    assert.match(signedAnnexureProblem({ name: "big.pdf", type: "application/pdf", size: 151 * MB }, 150 * MB) ?? "", /over 150 MB/);
    assert.equal(signedAnnexureProblem({ name: "empty.pdf", type: "application/pdf", size: 0 }, 150 * MB), "This file is empty.");
  });
});
