import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NAV_GROUPS, navGroupsFor } from "./nav";

const yourWork = (groups: typeof NAV_GROUPS) => groups[0].links.map((l) => l.label);

describe("navGroupsFor", () => {
  it("puts Property management straight after Home for a property manager, and keeps Listings", () => {
    assert.deepEqual(yourWork(navGroupsFor({ isPropertyManager: true })).slice(0, 3), [
      "Home",
      "Property management",
      "Listings",
    ]);
  });

  it("leaves everyone else's menu as it was", () => {
    assert.equal(navGroupsFor({ isPropertyManager: false }), NAV_GROUPS);
    assert.deepEqual(yourWork(navGroupsFor({})).slice(0, 3), ["Home", "Listings", "Property management"]);
  });

  it("moves nothing but Property management", () => {
    const pm = navGroupsFor({ isPropertyManager: true });
    assert.deepEqual(
      pm.map((g) => g.links.map((l) => l.href).sort()),
      NAV_GROUPS.map((g) => g.links.map((l) => l.href).sort()),
    );
  });
});
