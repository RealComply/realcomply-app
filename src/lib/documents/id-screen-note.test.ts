import { test } from "node:test";
import assert from "node:assert/strict";
import { ID_SCREEN_SKIPPED, idScreenNote } from "@/lib/documents/id-screen-note";

// The identity card's file that went on without the ID check (1 Nov 2026).

const PATH = "agency/listing/a1/voi-certificate.pdf";

test("the card says the file went on without the check", () => {
  const note = idScreenNote({ idScreenSkipped: { path: PATH, at: "2026-11-01T00:00:00Z" } }, PATH);
  assert.deepEqual(note, { tone: "warn", text: ID_SCREEN_SKIPPED });
  assert.match(ID_SCREEN_SKIPPED, /couldn't be checked for identity documents just now/);
  assert.ok(!/[—–]/.test(ID_SCREEN_SKIPPED));
});

test("only about that file: a file that replaced it, or one that was checked, says nothing", () => {
  assert.equal(idScreenNote({ idScreenSkipped: { path: PATH } }, "agency/listing/a1/another.pdf"), null);
  assert.equal(idScreenNote({}, PATH), null);
  assert.equal(idScreenNote(null, PATH), null);
  assert.equal(idScreenNote({ idScreenSkipped: { path: PATH } }, null), null);
});
