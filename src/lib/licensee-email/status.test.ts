import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_FIRST_NOTE,
  licenseeEmailLine,
  licenseeEmailState,
  linkSendLines,
  waitingSentLine,
} from "./status";

const fmt = (iso: string) => `[${iso.slice(0, 10)}]`;

describe("where the licensee email stands (Master, 4 Nov 2026)", () => {
  it("is waiting until it confirms, and says so", () => {
    const state = licenseeEmailState({ email: " Lee@Example.invalid ", accepted: false, confirmation: null });
    assert.deepEqual(state, { kind: "waiting", email: "lee@example.invalid", lastSentAt: null, sendError: null });
    assert.equal(licenseeEmailLine(state, fmt), "Waiting for lee@example.invalid to confirm.");
    if (state.kind !== "waiting") throw new Error("waiting");
    assert.equal(waitingSentLine(state, fmt), "The confirm email hasn't been sent yet.");
  });

  it("says when the confirm email went, and where to look", () => {
    const state = licenseeEmailState({
      email: "lee@example.invalid",
      accepted: false,
      confirmation: { email: "lee@example.invalid", last_sent_at: "2026-11-04T01:00:00Z", last_send_error: null, confirmed_at: null },
    });
    if (state.kind !== "waiting") throw new Error("waiting");
    assert.equal(
      waitingSentLine(state, fmt),
      "Confirm email last sent on [2026-11-04]. If it hasn't arrived, ask them to check their spam or junk folder.",
    );
  });

  it("says a send that failed", () => {
    const state = licenseeEmailState({
      email: "lee@example.invalid",
      accepted: false,
      confirmation: { email: "lee@example.invalid", last_sent_at: null, last_send_error: "x", confirmed_at: null },
    });
    if (state.kind !== "waiting") throw new Error("waiting");
    assert.equal(waitingSentLine(state, fmt), "The confirm email couldn't be sent. Send it again.");
  });

  it("is confirmed once clicked", () => {
    const state = licenseeEmailState({
      email: "lee@example.invalid",
      accepted: true,
      confirmation: { email: "lee@example.invalid", last_sent_at: "2026-11-04T01:00:00Z", last_send_error: null, confirmed_at: "2026-11-04T02:00:00Z" },
    });
    assert.equal(licenseeEmailLine(state, fmt), "Confirmed by lee@example.invalid on [2026-11-04].");
  });

  it("needs nothing when it is the licensee's own login", () => {
    const state = licenseeEmailState({ email: "lee@example.invalid", accepted: true, confirmation: null });
    assert.equal(state.kind, "login");
    assert.equal(
      licenseeEmailLine(state, fmt),
      "lee@example.invalid is your licensee in charge's own RealComply login, so it doesn't need confirming.",
    );
  });

  it("ignores a confirmation for another address", () => {
    const state = licenseeEmailState({
      email: "new@example.invalid",
      accepted: false,
      confirmation: { email: "old@example.invalid", last_sent_at: "2026-11-01T00:00:00Z", last_send_error: null, confirmed_at: "2026-11-01T01:00:00Z" },
    });
    assert.deepEqual(state, { kind: "waiting", email: "new@example.invalid", lastSentAt: null, sendError: null });
  });

  it("has nothing to say with no email but that", () => {
    assert.equal(
      licenseeEmailLine(licenseeEmailState({ email: "  ", accepted: false, confirmation: null }), fmt),
      "No licensee email yet. Nothing can be sent to your licensee until there is one.",
    );
  });

  it("puts the responsibility with the office (Adam, 4 Nov 2026)", () => {
    assert.ok(CONFIRM_FIRST_NOTE.includes("Your office is responsible for it being your licensee's address."));
  });
});

describe("last sent to [address] on [date]", () => {
  it("lists each kind once, in a fixed order, and says the invite isn't sent by RealComply", () => {
    const lines = linkSendLines(
      [
        { kind: "licensee_invite", sent_to: "lee@example.invalid", sent_at: "2026-11-02T00:00:00Z" },
        { kind: "file_signoff", sent_to: "lee@example.invalid", sent_at: "2026-11-03T00:00:00Z" },
        { kind: "confirm", sent_to: "lee@example.invalid", sent_at: "2026-11-01T00:00:00Z" },
        { kind: "something_else", sent_to: "x@example.invalid", sent_at: "2026-11-01T00:00:00Z" },
      ],
      fmt,
    );
    assert.deepEqual(lines, [
      "Confirm email: last sent to lee@example.invalid on [2026-11-01]",
      "File sign-off link: last sent to lee@example.invalid on [2026-11-03]",
      "Invite to join RealComply: made for lee@example.invalid on [2026-11-02] (you send this one yourself)",
    ]);
  });

  it("has no em dashes", () => {
    for (const line of [CONFIRM_FIRST_NOTE]) assert.ok(!line.includes("—"));
  });
});
