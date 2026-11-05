import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contractReadFailed, contractReadFrom, contractReadNote, contractReadOf } from "./contract-read";

// The contract is read the moment it's attached; a read that fails says so on
// its card (Adam, 5 Nov 2026).

const at = "2026-11-05T01:00:00.000Z";

describe("the contract card's read", () => {
  it("counts the prescribed documents found, and says nothing when the read went well", () => {
    const r = contractReadFrom(
      [{ itemKey: "b1", prescribedDocs: [{ found: true }, { found: false }, { found: true }] }],
      "a/p/b1/contract.pdf",
      at,
    );
    assert.deepEqual(r, { at, path: "a/p/b1/contract.pdf", outcome: "read", found: 2, checked: 3 });
    assert.equal(contractReadNote(r), null);
  });

  it("knows a file that isn't a contract, and leaves saying so to the card's own message", () => {
    const r = contractReadFrom([{ itemKey: "b1", notAContract: true }], "a/p/b1/x.pdf", at);
    assert.equal(r.outcome, "wrong_document");
    assert.equal(contractReadNote(r), null);
  });

  it("says plainly when the contract couldn't be read", () => {
    const note = contractReadNote(contractReadFailed("The file is too large to read.", "a/p/b1/c.pdf", at));
    assert.equal(note?.tone, "warn");
    assert.equal(
      note?.text,
      "Contract not read: The file is too large to read. The prescribed documents haven't been checked. Read again, or check them with the solicitor who prepared the contract.",
    );
    assert.ok(!note!.text.includes("—"));
  });

  it("only speaks about the file attached now", () => {
    const data = { contractRead: contractReadFailed("x", "a/p/b1/old.pdf", at) };
    assert.equal(contractReadOf(data, "a/p/b1/new.pdf"), null);
    assert.equal(contractReadOf(data, "a/p/b1/old.pdf")?.outcome, "failed");
    assert.equal(contractReadOf(data, null), null);
  });
});
