import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRM_CANCEL_SIGNOFF,
  cancellationLine,
  fileSignoffCancelledLine,
  isReopenable,
  priceApprovalReopenedLine,
  reopenedLine,
  requestFor,
  requestLine,
  showsSharedReopen,
  type Cancellation,
  type ReopenRequest,
} from "@/lib/rules/reopen";

const AT = "2026-10-28T03:00:00Z"; // 28 October in Sydney
const names = (id: string | null) => ({ a: "Ana Agent", l: "Lee Licensee" })[id ?? ""] ?? "a team member";
const titles = (key: string) =>
  ({ a4: "Estimated selling price (ESP) recorded", c1: "Advertised price guide vs ESP" })[key] ?? key;

describe("which cards show the shared Reopen", () => {
  it("only on a card that is done or flagged, never on the finalised file", () => {
    assert.equal(isReopenable({ key: "c1", kind: "guide" }, "done"), true);
    assert.equal(isReopenable({ key: "c1", kind: "guide" }, "flagged"), true);
    assert.equal(isReopenable({ key: "c1", kind: "guide" }, "open"), false);
    assert.equal(isReopenable({ key: "c1", kind: "guide" }, undefined), false);
    assert.equal(isReopenable({ key: "f2", kind: "export" }, "done"), false);
  });

  it("not on a checklist card or the ESP revision, which carry their own, until the file is signed off", () => {
    assert.equal(showsSharedReopen({ key: "a5", kind: "checklist" }, "done", false), false);
    assert.equal(showsSharedReopen({ key: "d3", kind: "reduction" }, "done", false), false);
    assert.equal(showsSharedReopen({ key: "a5", kind: "checklist" }, "done", true), true);
  });

  it("on every other card, the price statement approval and the signatures included", () => {
    for (const card of [
      { key: "c1", kind: "guide" },
      { key: "x1", kind: "auctioneer" },
      { key: "x4", kind: "reserve" },
      { key: "x8", kind: "auction" },
      { key: "d2", kind: "offers" },
      { key: "f3", kind: "reports" },
      { key: "f0", kind: "sale" },
      { key: "poa", kind: "question" },
      { key: "poa_doc", kind: "document" },
      { key: "b4", kind: "checklist" },
      { key: "sign_agent", kind: "sign" },
      { key: "sign_licensee", kind: "sign" },
      { key: "send_licensee", kind: "send" },
    ]) {
      assert.equal(showsSharedReopen(card, "done", false), true, card.key);
    }
  });
});

describe("the words", () => {
  it("asks before cancelling the file sign-off", () => {
    assert.equal(
      CONFIRM_CANCEL_SIGNOFF,
      "Reopening this card cancels the file sign-off. The file will need signing off again. Reopen?",
    );
  });

  it("says who reopened a card and when", () => {
    assert.equal(reopenedLine("Ana Agent", AT), "Reopened by Ana Agent, 28 October 2026.");
  });

  it("says why the price statement approval went back to open", () => {
    assert.equal(
      priceApprovalReopenedLine({ name: "Ana Agent", at: AT, why: "reopened", becauseTitle: "Estimated selling price (ESP) recorded" }),
      "Reopened by Ana Agent, 28 October 2026, because “Estimated selling price (ESP) recorded” was reopened. The licensee needs to approve again.",
    );
    assert.equal(
      priceApprovalReopenedLine({ name: "Ana Agent", at: AT, why: "esp_changed", becauseTitle: "x" }),
      "Reopened by Ana Agent, 28 October 2026, because the ESP on the file changed. The licensee needs to approve again.",
    );
    assert.equal(
      priceApprovalReopenedLine({ name: "Lee Licensee", at: AT, why: "withdrawn", becauseTitle: null }),
      "Reopened by Lee Licensee, 28 October 2026. The licensee needs to approve again.",
    );
  });

  it("says why the file sign-off was cancelled", () => {
    assert.equal(
      fileSignoffCancelledLine({ name: "Lee Licensee", at: AT, becauseTitle: "Advertised price guide vs ESP" }),
      "File sign-off cancelled by Lee Licensee, 28 October 2026, because “Advertised price guide vs ESP” was reopened. The file needs signing off again.",
    );
  });
});

describe("cancelled approvals and signatures in the history", () => {
  const base = { id: "c", cancelledAt: AT, cancelledBy: "a", becauseItemKey: "a4" } as const;

  it("an approval given in the app, cancelled when the ESP card was reopened", () => {
    const c: Cancellation = {
      ...base,
      itemKey: "b4",
      because: "reopened",
      card: { status: "done", completed_by: "l", data: { note: "$900,000 to $950,000", signedAt: "2026-10-20T01:00:00Z", signedBy: "l" } },
    };
    assert.equal(
      cancellationLine(c, names, titles),
      "Approved by Lee Licensee on 20 October 2026: “$900,000 to $950,000”. Cancelled 28 October 2026 by Ana Agent, because “Estimated selling price (ESP) recorded” was reopened.",
    );
  });

  it("an approval given by email names the licensee as they typed it", () => {
    const c: Cancellation = {
      ...base,
      itemKey: "b4",
      because: "esp_changed",
      card: {
        status: "done",
        completed_by: null,
        data: { note: "Guide $900k", signedVia: "link", signedName: "Lee L", signoffRequestId: "r1", signedAt: "2026-10-20T01:00:00Z" },
      },
    };
    assert.equal(
      cancellationLine(c, names, titles),
      "Approved by Lee L on 20 October 2026 by email: “Guide $900k”. Cancelled 28 October 2026 by Ana Agent, because the ESP on the file changed.",
    );
  });

  it("a signature cancelled when the licensee reopened a card on the signed-off file", () => {
    const c: Cancellation = {
      ...base,
      cancelledBy: "l",
      becauseItemKey: "c1",
      itemKey: "sign_licensee",
      because: "file_reopened",
      card: { status: "done", data: { typedName: "Lee Licensee", signedAt: "2026-10-25T01:00:00Z" } },
    };
    assert.equal(
      cancellationLine(c, names, titles),
      "Signed by Lee Licensee on 25 October 2026. Cancelled 28 October 2026 by Lee Licensee, because “Advertised price guide vs ESP” was reopened.",
    );
  });

  it("an approval the licensee reopened themselves says no more than that", () => {
    const c: Cancellation = {
      ...base,
      cancelledBy: "l",
      becauseItemKey: "b4",
      itemKey: "b4",
      because: "withdrawn",
      card: { status: "done", completed_by: "l", data: { note: "Guide" } },
    };
    assert.equal(cancellationLine(c, names, titles), "Approved by Lee Licensee: “Guide”. Cancelled 28 October 2026 by Lee Licensee.");
  });
});

describe("requests to reopen", () => {
  const waiting: ReopenRequest = {
    id: "r1",
    itemKey: "c1",
    reason: "The guide changed.",
    requestedBy: "a",
    requestedAt: AT,
    status: "waiting",
    answeredBy: null,
    answeredAt: null,
  };

  it("shows the waiting one for the card, else the latest answered", () => {
    const declined = { ...waiting, id: "r0", status: "declined" as const, requestedAt: "2026-10-27T03:00:00Z", answeredAt: AT };
    assert.equal(requestFor([declined, waiting], "c1")?.id, "r1");
    assert.equal(requestFor([declined], "c1")?.id, "r0");
    assert.equal(requestFor([declined], "f0"), null);
  });

  it("is worded for whoever is looking", () => {
    assert.equal(
      requestLine(waiting, { id: "a", isLicensee: false }, names),
      "You asked the licensee to reopen this on 28 October 2026. Waiting on the licensee. Your reason: “The guide changed.”",
    );
    assert.equal(
      requestLine(waiting, { id: "l", isLicensee: true }, names),
      "Ana Agent asked you to reopen this card on 28 October 2026. Their reason: “The guide changed.”",
    );
    assert.equal(
      requestLine({ ...waiting, status: "declined", answeredBy: "l", answeredAt: AT }, { id: "a", isLicensee: false }, names),
      "The licensee declined the request to reopen this on 28 October 2026.",
    );
  });
});
