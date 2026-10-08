import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGAL_DOCUMENTS, currentLegalVersions } from "@/lib/legal/documents";
import { acceptsCurrentVersions } from "@/lib/legal/acceptance";

// The brief of 2 Oct 2026: "Do not change any wording in Parts B, C or D. Not
// grammar, not spelling, not clause numbers." This holds the code to that, by
// comparing each published body with the brief character for character. If
// it fails, the text in documents.ts has drifted from what Adam approved.
const BRIEF = readFileSync(join(process.cwd(), "claude/RealComply-legal-documents-publish-brief-2-Oct.md"), "utf8");

function part(startHeading: string, nextHeading: string | null): string {
  const start = BRIEF.indexOf(startHeading);
  assert.ok(start >= 0, `brief is missing "${startHeading}"`);
  const from = start + startHeading.length;
  const to = nextHeading ? BRIEF.indexOf(nextHeading, from) : BRIEF.length;
  return BRIEF.slice(from, to).trim().replace(/\n---$/, "").trim();
}

describe("published legal documents", () => {
  it("terms are Part B of the brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.terms.body, part("## PART B: Terms and Conditions (final text)", "## PART C:"));
  });

  it("privacy policy is Part C of the brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.privacy.body, part("## PART C: Privacy Policy (final text)", "## PART D:"));
  });

  it("DPA is Part D of the brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.dpa.body, part("## PART D: Data Processing Agreement (final text)", null));
  });

  it("all three are reviewed, so acceptances are no longer stamped as drafts", () => {
    for (const doc of Object.values(LEGAL_DOCUMENTS)) {
      assert.equal(doc.reviewed, true, doc.key);
      assert.ok(!doc.version.includes("draft"), doc.key);
    }
  });
});

describe("acceptsCurrentVersions", () => {
  const current = currentLegalVersions();

  it("is false for someone who only accepted the August drafts", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: "2026-08-22-draft", privacy_version: "2026-08-22-draft" }], current),
      false,
    );
  });

  it("is false for someone with no acceptance at all", () => {
    assert.equal(acceptsCurrentVersions([], current), false);
  });

  it("needs both documents at the current version, not just one", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: current.terms, privacy_version: "2026-08-22-draft" }], current),
      false,
    );
  });

  it("is true once the current pair is on record", () => {
    assert.equal(
      acceptsCurrentVersions(
        [
          { terms_version: "2026-08-22-draft", privacy_version: "2026-08-22-draft" },
          { terms_version: current.terms, privacy_version: current.privacy },
        ],
        current,
      ),
      true,
    );
  });
});
