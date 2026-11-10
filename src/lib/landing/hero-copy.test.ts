import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HERO_LEAD_BEFORE, PAGE_TITLE, heroBadge, heroLead } from "./hero-copy";

// The same instants the rules tests use. REFORMS_FROM is 2026-11-16T13:00:00.000Z.
const BEFORE = new Date("2026-11-16T12:59:59Z");
const ON = new Date("2026-11-16T13:00:00Z");

describe("landing hero reforms hook", () => {
  it("says the changes start on 17 November until that midnight in Sydney", () => {
    assert.equal(heroBadge(BEFORE), "NSW underquoting changes start 17 November 2026.");
    assert.equal(heroLead(BEFORE), HERO_LEAD_BEFORE);
    assert.match(heroLead(BEFORE), /^From 17 November, every residential ad needs a price/);
    assert.match(heroLead(BEFORE), /you still have the final say\.$/);
  });

  it("says the changes are in force from that midnight", () => {
    assert.equal(heroBadge(ON), "NSW underquoting changes are now in force.");
    assert.doesNotMatch(heroLead(ON), /From 17 November/);
    assert.match(heroLead(ON), /^Every residential ad needs a price, and it can't sit below your estimate\./);
    assert.match(heroLead(ON), /you still have the final say\.$/);
  });

  it("keeps the page title free of an em dash", () => {
    assert.equal(PAGE_TITLE, "RealComply. Stay on top of compliance, without a full-time hire");
    assert.equal(PAGE_TITLE.includes("\u2014"), false);
  });

  it("does not say RealComply makes anyone compliant", () => {
    for (const now of [BEFORE, ON]) {
      const text = `${heroBadge(now)} ${heroLead(now)} ${PAGE_TITLE}`;
      assert.equal(/compliant/i.test(text), false);
      assert.equal(text.includes("\u2014"), false);
    }
  });
});
