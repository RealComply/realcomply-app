import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { earlierApprovalLine, espRangeText, priceApproval, tickedLine } from "./price-statement";

// b4, the price statement card. REVERSAL (Adam, 2 Nov 2026): an agent ticks it
// now, and the database stamps who and when (0104). The licensee's approvals
// from before then still read as they did. The rules for the emailed link
// went with it; their tests are in git history.

describe("an agent's tick, from 2 Nov 2026", () => {
  const people = new Map([["agent-1", { full_name: "Ana Agent" }], ["lic-1", { full_name: "Lee Licensee" }]]);
  const tick = { note: "Guide $900,000 to $950,000", tickedBy: "agent-1", tickedAt: "2026-11-02T03:15:00Z" };

  it("reads as a tick, naming whoever ticked it", () => {
    assert.deepEqual(priceApproval({ status: "done", data: tick, completed_by: "agent-1" }, people), {
      text: "Guide $900,000 to $950,000",
      via: "tick",
      name: "Ana Agent",
      at: "2026-11-02T03:15:00Z",
      sentTo: null,
    });
  });

  it("says who ticked it and the date, like any other card", () => {
    const approval = priceApproval({ status: "done", data: tick, completed_by: "agent-1" }, people)!;
    assert.equal(tickedLine(approval), "Ticked by Ana Agent, 2 November 2026");
    assert.equal(tickedLine({ name: null, at: null }), "Ticked by a team member");
  });

  it("names the licensee when they are the one who ticked it", () => {
    const approval = priceApproval({ status: "done", data: { ...tick, tickedBy: "lic-1" }, completed_by: "lic-1" }, people);
    assert.equal(approval?.via, "tick");
    assert.equal(approval?.name, "Lee Licensee");
  });

  it("is nothing on a card that isn't ticked", () => {
    assert.equal(priceApproval({ status: "open", data: tick, completed_by: null }, people), null);
  });
});

describe("the licensee's approval from before 2 Nov 2026, as it read", () => {
  const when = (iso: string) => `[${iso}]`;
  it("through the emailed link, with the address and the time", () => {
    const approval = priceApproval({
      status: "done",
      completed_by: null,
      data: { note: "Guide $750,000", signedVia: "link", signedName: "Lee Licensee", signoffRequestId: "r1", signedAt: "2026-10-12T02:15:00Z", sentTo: "lee@example.com" },
    })!;
    assert.equal(
      earlierApprovalLine(approval, when),
      "Approved by Lee Licensee through the emailed link to lee@example.com, [2026-10-12T02:15:00Z] (Sydney time)",
    );
  });
  it("in RealComply, with the time where it was stamped", () => {
    const approval = priceApproval({ status: "done", completed_by: "u1", data: { note: "Guide $1.2m", signedAt: "2026-10-20T01:00:00Z", signedBy: "u1" } })!;
    assert.equal(earlierApprovalLine(approval, when), "Approved in RealComply by the licensee in charge, [2026-10-20T01:00:00Z] (Sydney time)");
    const older = priceApproval({ status: "done", completed_by: "u1", data: { note: "Guide $1.2m" } })!;
    assert.equal(earlierApprovalLine(older, when), "Approved in RealComply by the licensee in charge");
  });
});

describe("priceApproval", () => {
  const link = {
    note: "Guide $750,000 – $790,000",
    signedName: "Lee Licensee",
    signedVia: "link",
    signoffRequestId: "r1",
    signedAt: "2026-10-12T02:15:00Z",
    sentTo: "lee@example.com",
  };

  it("is null on a card that is not done, whatever its data says", () => {
    assert.equal(priceApproval({ status: "open", data: link, completed_by: null }), null);
    assert.equal(priceApproval({ status: "flagged", data: link, completed_by: null }), null);
    assert.equal(priceApproval(undefined), null);
  });

  it("reads an approval given through the emailed link", () => {
    assert.deepEqual(priceApproval({ status: "done", data: link, completed_by: null }), {
      text: "Guide $750,000 – $790,000",
      via: "link",
      name: "Lee Licensee",
      at: "2026-10-12T02:15:00Z",
      sentTo: "lee@example.com",
    });
  });

  it("reads as the app when someone signed in completed it, even with the link's keys on it", () => {
    const people = new Map([["u1", { full_name: "Pat Principal" }]]);
    const approval = priceApproval({ status: "done", data: link, completed_by: "u1" }, people);
    assert.equal(approval?.via, "app");
    assert.equal(approval?.name, "Pat Principal");
    assert.equal(approval?.sentTo, null);
  });

  it("reads as the app without the request it came from", () => {
    const noRequest: Record<string, unknown> = { ...link };
    delete noRequest.signoffRequestId;
    assert.equal(priceApproval({ status: "done", data: noRequest, completed_by: null })?.via, "app");
  });

  it("names the licensee from signedBy when completed_by is missing", () => {
    const people = new Map([["u2", { full_name: "Sam Licensee" }]]);
    const approval = priceApproval(
      { status: "done", data: { note: "Offers over $1m", signedAt: "2026-10-01T00:00:00Z", signedBy: "u2" }, completed_by: null },
      people,
    );
    assert.equal(approval?.via, "app");
    assert.equal(approval?.name, "Sam Licensee");
  });

  it("gives an older row, with no time, its note only", () => {
    assert.deepEqual(priceApproval({ status: "done", data: { note: "Guide $1.2m" }, completed_by: "u1" }), {
      text: "Guide $1.2m",
      via: "app",
      name: null,
      at: null,
      sentTo: null,
    });
  });
});

describe("espRangeText", () => {
  it("writes a range, a single figure, or nothing", () => {
    assert.equal(espRangeText(750000, 790000), "$750,000 to $790,000");
    assert.equal(espRangeText(750000, 750000), "$750,000");
    assert.equal(espRangeText(null, 790000), null);
  });
  // The database writes the statement with to_char, which rounds to whole
  // dollars and a half up. The email and the card must read the same.
  it("rounds to whole dollars, a half up, as the database's statement does", () => {
    assert.equal(espRangeText(750000.5, 790000), "$750,001 to $790,000");
    assert.equal(espRangeText(750000.49, 790000.5), "$750,000 to $790,001");
    assert.equal(espRangeText(1200000.5, 1200000.5), "$1,200,001");
  });
});
