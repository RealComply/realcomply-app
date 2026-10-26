import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { remindableNow, staffStillToDo, type ReminderPerson } from "./outstanding";

const person = (id: string, extra: Partial<ReminderPerson> = {}): ReminderPerson => ({
  id,
  full_name: id.toUpperCase(),
  email: `${id}@example.invalid`,
  is_agent: true,
  is_assistant: false,
  is_licensee_in_charge: false,
  archived_at: null,
  ...extra,
});

const base = {
  staff: [person("om"), person("a"), person("b"), person("asst", { is_agent: false, is_assistant: true })],
  senderId: "om",
  currentSgDocumentId: "doc1",
  signatures: [
    { document_id: "doc1", signer_id: "a", signed_at: null },
    { document_id: "doc1", signer_id: "b", signed_at: "2026-10-20T00:00:00Z" },
    { document_id: "doc1", signer_id: "asst", signed_at: null },
    { document_id: "doc1", signer_id: "om", signed_at: null },
  ],
  adoptedVersion: "1.0",
  readConfirmations: [{ confirmed_by: "b", annexure_version: "1.0" }],
  reminders: [],
};

describe("who still needs to sign or read the Supervision Guidelines", () => {
  it("lists each outstanding person once, with everything they still need to do", () => {
    const out = staffStillToDo(base);
    assert.deepEqual(
      out.map((o) => [o.person.id, o.kinds]),
      [
        ["a", ["sg_manual_sign", "sg_read"]],
        ["asst", ["sg_manual_sign"]],
      ],
    );
  });

  it("never the sender, and never anyone who has left", () => {
    const out = staffStillToDo({ ...base, staff: [...base.staff, person("gone", { archived_at: "2026-10-01T00:00:00Z" })] });
    assert.ok(!out.some((o) => o.person.id === "om" || o.person.id === "gone"));
  });

  it("asks an assistant or the licensee to sign, but not to read and tick", () => {
    const out = staffStillToDo({
      ...base,
      staff: [person("lic", { is_licensee_in_charge: true }), person("asst", { is_agent: false, is_assistant: true })],
      signatures: [],
    });
    assert.deepEqual(out, []);
  });

  it("asks nobody to read when the office hasn't adopted the annexure, and nobody to sign with no SG Manual", () => {
    assert.deepEqual(staffStillToDo({ ...base, adoptedVersion: null, currentSgDocumentId: null }), []);
  });

  it("a confirmation of an older version doesn't count", () => {
    const out = staffStillToDo({ ...base, readConfirmations: [{ confirmed_by: "b", annexure_version: "0.9" }] });
    assert.ok(out.some((o) => o.person.id === "b" && o.kinds.includes("sg_read")));
  });

  it("carries when each was last reminded, and a day must pass before the next", () => {
    const out = staffStillToDo({ ...base, reminders: [{ profile_id: "a", created_at: "2026-10-26T01:00:00Z" }] });
    assert.equal(out.find((o) => o.person.id === "a")?.lastRemindedAt, "2026-10-26T01:00:00Z");
    assert.equal(remindableNow("2026-10-26T01:00:00Z", new Date("2026-10-26T10:00:00Z")), false);
    assert.equal(remindableNow("2026-10-26T01:00:00Z", new Date("2026-10-26T21:00:00Z")), true);
    assert.equal(remindableNow(null, new Date()), true);
  });
});
