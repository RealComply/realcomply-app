import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { accessFrom } from "@/lib/access";
import { digestLink } from "./weekly-digest";

const licensee = { is_licensee_in_charge: true, is_assistant: false, archived_at: null };
const agent = { is_licensee_in_charge: false, is_assistant: false, archived_at: null };

describe("digestLink", () => {
  it("sends the licensee in charge to Office overview", () => {
    assert.match(digestLink(accessFrom(licensee, "office_1").actsAsLicensee).href, /\/dashboard\/portfolio$/);
  });

  it("sends an agent in an office to their listings, not to a page that is not found for them", () => {
    const link = digestLink(accessFrom(agent, "office_2").actsAsLicensee);
    assert.match(link.href, /\/dashboard$/);
    assert.equal(link.label, "Open your listings");
  });

  it("sends the agent on their own plan to Office overview, which they can open", () => {
    assert.match(digestLink(accessFrom(agent, "agent_1").actsAsLicensee).href, /\/dashboard\/portfolio$/);
  });
});
