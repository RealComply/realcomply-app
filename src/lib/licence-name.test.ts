import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { firstName, normaliseName, possessive, sameName } from "./licence-name";
import { PENDING_READ_MAX_AGE_MS, pendingReadProblem, signPendingRead, verifyPendingRead, type PendingRead } from "./pending-read";

// The licence name check asks instead of refusing (Adam, 15 Oct 2026).

describe("The same name", () => {
  it("ignores case, punctuation and extra spaces, and nothing else", () => {
    assert.equal(sameName("JO  BENNETT", "Jo Bennett"), true);
    assert.equal(sameName("Jo-Anne O'Brien", "jo anne o brien"), true);
    assert.equal(sameName(" Sue Edwards. ", "Sue Edwards"), true);
    assert.equal(normaliseName("SMITH, Jane-Maree "), "smith jane maree");
  });

  it("any other difference is a different name, so it asks", () => {
    assert.equal(sameName("Susan Elizabeth Edwards", "Sue Edwards"), false);
    assert.equal(sameName("Joanne Mary Bennett", "Jo Bennett"), false);
    assert.equal(sameName("Bennett Jo", "Jo Bennett"), false, "order is a difference");
    assert.equal(sameName("", ""), false, "nothing is never a match");
  });

  it("words for the question", () => {
    assert.equal(firstName("Jo Bennett"), "Jo");
    assert.equal(firstName("Cher"), "Cher");
    assert.equal(possessive("Jo"), "Jo’s");
  });
});

describe("The read held with the question", () => {
  const SECRET = "test-secret";
  const now = 1_800_000_000_000;
  const pending: PendingRead<{ licenceNumber: string }> = {
    v: 1,
    kind: "licence",
    profileId: "p1",
    askedBy: "lic",
    path: "ag/_licences/p1/1-licence.pdf",
    fileName: "Jo licence 2026.pdf",
    fresh: true,
    nameOnDocument: "Joanne Mary Bennett",
    read: { licenceNumber: "20123456" },
    issuedAt: now,
  };

  it("comes back exactly as it went", () => {
    const token = signPendingRead(pending, SECRET);
    const v = verifyPendingRead(token, SECRET, { kind: "licence", answeredBy: "lic", now: now + 60_000 });
    assert.deepEqual(v, { ok: true, pending });
  });

  it("refuses one changed in the browser", () => {
    const token = signPendingRead(pending, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...pending, read: { licenceNumber: "99999999" } })).toString("base64url");
    assert.deepEqual(verifyPendingRead(`${forged}.${sig}`, SECRET, { kind: "licence", answeredBy: "lic", now }), {
      ok: false,
      reason: "invalid",
    });
    assert.equal(verifyPendingRead(token, "other-secret", { kind: "licence", answeredBy: "lic", now }).ok, false);
    assert.equal(verifyPendingRead("nonsense", SECRET, { kind: "licence", answeredBy: "lic", now }).ok, false);
  });

  it("only the person asked can answer, only for what was asked, and not after two hours", () => {
    const token = signPendingRead(pending, SECRET);
    assert.deepEqual(verifyPendingRead(token, SECRET, { kind: "licence", answeredBy: "someone-else", now }), {
      ok: false,
      reason: "not_yours",
    });
    assert.equal(verifyPendingRead(token, SECRET, { kind: "cpd", answeredBy: "lic", now }).ok, false);
    assert.deepEqual(verifyPendingRead(token, SECRET, { kind: "licence", answeredBy: "lic", now: now + PENDING_READ_MAX_AGE_MS + 1 }), {
      ok: false,
      reason: "expired",
    });
    assert.match(pendingReadProblem("expired", "licence"), /expired, so nothing was saved\. Upload the licence again/);
  });
});
