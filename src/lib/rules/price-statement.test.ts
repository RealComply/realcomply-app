import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVER_NAME_MAX,
  PRICE_STATEMENT_MAX,
  approverNameTooLong,
  espRangeText,
  noLicenseeEmailMessage,
  normalisePriceStatement,
  priceApproval,
  priceRequestStale,
  priceStatementByEmail,
  sentBackPriceStatementLine,
} from "./price-statement";

describe("normalisePriceStatement", () => {
  it("trims and makes every run of spaces or line breaks one space", () => {
    assert.equal(normalisePriceStatement("  Guide   $750,000 –\n\n $790,000 \t"), "Guide $750,000 – $790,000");
  });
  it("takes 300 characters and refuses 301", () => {
    assert.equal(normalisePriceStatement("x".repeat(PRICE_STATEMENT_MAX))?.length, 300);
    assert.equal(normalisePriceStatement("x".repeat(PRICE_STATEMENT_MAX + 1)), null);
    // Counted as the database counts: characters, not UTF-16 units.
    assert.ok(normalisePriceStatement("🏠".repeat(PRICE_STATEMENT_MAX)));
  });
  it("is null when there is nothing to approve", () => {
    assert.equal(normalisePriceStatement(""), null);
    assert.equal(normalisePriceStatement("   \n "), null);
    assert.equal(normalisePriceStatement(null), null);
    assert.equal(normalisePriceStatement(42), null);
  });
});

describe("priceStatementByEmail", () => {
  const person = (over: Partial<{ is_licensee_in_charge: boolean; archived_at: string | null }>) => ({
    is_licensee_in_charge: false,
    archived_at: null,
    ...over,
  });
  it("goes by email when nobody is a licensee in charge", () => {
    assert.equal(priceStatementByEmail([]), true);
    assert.equal(priceStatementByEmail([person({}), person({})]), true);
  });
  it("stays in the app when the office has an active licensee in charge", () => {
    assert.equal(priceStatementByEmail([person({}), person({ is_licensee_in_charge: true })]), false);
  });
  it("goes by email when the only licensee in charge has left", () => {
    assert.equal(priceStatementByEmail([person({ is_licensee_in_charge: true, archived_at: "2026-09-01T00:00:00Z" })]), true);
  });
  it("stays in the app while one licensee in charge is active, whoever else has left", () => {
    const left = person({ is_licensee_in_charge: true, archived_at: "2026-09-01T00:00:00Z" });
    assert.equal(priceStatementByEmail([left, person({ is_licensee_in_charge: true })]), false);
    assert.equal(priceStatementByEmail([person({ is_licensee_in_charge: true }), left]), false);
  });
  it("goes by email when every licensee in charge has left", () => {
    const left = (at: string) => person({ is_licensee_in_charge: true, archived_at: at });
    assert.equal(priceStatementByEmail([left("2026-08-01T00:00:00Z"), left("2026-09-01T00:00:00Z"), person({})]), true);
  });
});

describe("sentBackPriceStatementLine", () => {
  // Nobody signed in can mark b4 done when it goes by email, so the note on
  // the card and the to-do list can't tell the agent to.
  it("sends the agent to the send form on b4 when it goes by email", () => {
    assert.equal(
      sentBackPriceStatementLine("b4", true),
      "Send the price statement to your licensee again from this card. Their approval clears this note.",
    );
  });
  it("leaves b4 in the app, and every other card, to the usual words", () => {
    assert.equal(sentBackPriceStatementLine("b4", false), null);
    assert.equal(sentBackPriceStatementLine("a4", true), null);
    assert.equal(sentBackPriceStatementLine("sign_licensee", true), null);
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

describe("priceRequestStale", () => {
  const items = (over: Record<string, { status?: string; data?: unknown }> = {}) => ({
    a4: { status: "done", data: { espLow: 750000, espHigh: 790000 } },
    a4c: { status: "done", data: {} },
    ...over,
  });
  const request = { espLow: 750000, espHigh: 790000 };

  it("is current while the ESP on foot is the one shown and the reasoning card is done", () => {
    assert.equal(priceRequestStale(request, items()), false);
  });
  it("is stale once the ESP changes", () => {
    assert.equal(priceRequestStale(request, items({ a4: { status: "done", data: { espLow: 760000, espHigh: 790000 } } })), true);
  });
  it("follows a revised ESP on d3, both figures or neither", () => {
    const revised = items({ d3: { status: "done", data: { revisedEspLow: 700000, revisedEspHigh: 740000 } } });
    assert.equal(priceRequestStale(request, revised), true);
    assert.equal(priceRequestStale({ espLow: 700000, espHigh: 740000 }, revised), false);
    const half = items({ d3: { status: "done", data: { revisedEspLow: 700000 } } });
    assert.equal(priceRequestStale(request, half), false);
  });
  it("is stale once the ESP reasoning card is reopened", () => {
    assert.equal(priceRequestStale(request, items({ a4c: { status: "open", data: {} } })), true);
  });
  it("matches a request sent with no ESP on file only while there is still none", () => {
    const none = { espLow: null, espHigh: null };
    assert.equal(priceRequestStale(none, items({ a4: { status: "open", data: {} } })), false);
    assert.equal(priceRequestStale(none, items()), true);
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

describe("approverNameTooLong", () => {
  it("takes 200 characters and refuses 201, as the database does", () => {
    assert.equal(approverNameTooLong("x".repeat(APPROVER_NAME_MAX)), false);
    assert.equal(approverNameTooLong("x".repeat(APPROVER_NAME_MAX + 1)), true);
  });
  it("counts characters, not UTF-16 units", () => {
    assert.equal(approverNameTooLong("😀".repeat(APPROVER_NAME_MAX)), false);
  });
  it("ignores the spaces around the name", () => {
    assert.equal(approverNameTooLong(`  ${"x".repeat(APPROVER_NAME_MAX)}  `), false);
  });
});

describe("noLicenseeEmailMessage", () => {
  it("sends the agent on their own plan to Team", () => {
    assert.equal(
      noLicenseeEmailMessage({ actsAsLicensee: true, worksAsAgentPlan: true }),
      "Add your licensee in charge's email in Team settings first.",
    );
  });
  it("sends their assistant to the agent, who can add it", () => {
    assert.equal(
      noLicenseeEmailMessage({ actsAsLicensee: false, worksAsAgentPlan: true }),
      "Ask your agent to add your licensee in charge's email in Team settings.",
    );
  });
  it("sends an office whose licensee isn't on RealComply to support", () => {
    assert.equal(
      noLicenseeEmailMessage({ actsAsLicensee: false, worksAsAgentPlan: false }),
      "There's no email on file for your licensee in charge. Contact RealComply support to add it.",
    );
  });
});
