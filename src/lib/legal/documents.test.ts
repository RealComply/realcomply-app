import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGAL_DOCUMENTS, acceptableLegalVersions, currentLegalVersions } from "@/lib/legal/documents";
import { acceptsCurrentVersions } from "@/lib/legal/acceptance";

// The brief of 9 Oct 2026: "Do not change any wording in Parts B, C or D. Not
// grammar, not spelling, not clause numbers." This holds the code to that, by
// comparing each published body with the brief character for character. If
// it fails, the text in documents.ts has drifted from what Adam approved.
// The privacy policy has its own brief from 16 Oct 2026 (one paragraph added).
const BRIEF = readFileSync(join(process.cwd(), "claude/RealComply-legal-documents-publish-brief-9-Oct.md"), "utf8");
const PRIVACY_BRIEF = readFileSync(join(process.cwd(), "claude/RealComply-privacy-policy-16-Oct.md"), "utf8");

function part(startHeading: string, nextHeading: string | null, brief = BRIEF): string {
  const start = brief.indexOf(startHeading);
  assert.ok(start >= 0, `brief is missing "${startHeading}"`);
  const from = start + startHeading.length;
  const to = nextHeading ? brief.indexOf(nextHeading, from) : brief.length;
  return brief.slice(from, to).trim().replace(/\n---$/, "").trim();
}

const EARLY_ACCESS_PARAGRAPH = `### If you register for early access

Your name, agency name and email address, and your phone number if you choose to give it. We use your phone number only to contact you about setting up RealComply.

`;

describe("published legal documents", () => {
  it("terms are Part B of the brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.terms.body, part("## PART B: Terms and Conditions (final text)", "## PART C:"));
  });

  it("privacy policy is Part C of the 16 Oct brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.privacy.body, part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF));
  });

  it("the 16 Oct privacy policy is the 9 Oct one plus the early access paragraph, nothing else", () => {
    const nineOct = part("## PART C: Privacy Policy (final text)", "## PART D:");
    assert.ok(LEGAL_DOCUMENTS.privacy.body.includes(EARLY_ACCESS_PARAGRAPH));
    assert.equal(LEGAL_DOCUMENTS.privacy.body.replace(EARLY_ACCESS_PARAGRAPH, ""), nineOct);
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
  const acceptable = acceptableLegalVersions();

  it("is false for someone who only accepted the August drafts", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: "2026-08-22-draft", privacy_version: "2026-08-22-draft" }], acceptable),
      false,
    );
  });

  it("is false for someone with no acceptance at all", () => {
    assert.equal(acceptsCurrentVersions([], acceptable), false);
  });

  it("needs both documents at the current version, not just one", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: current.terms, privacy_version: "2026-08-22-draft" }], acceptable),
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
        acceptable,
      ),
      true,
    );
  });

  it("new acceptances record the 16 Oct privacy policy", () => {
    assert.equal(current.privacy, "2026-10-16");
    assert.equal(current.terms, "2026-10-09");
  });

  it("someone who accepted on 9 Oct is not asked again for the 16 Oct privacy change", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: "2026-10-09", privacy_version: "2026-10-09" }], acceptable),
      true,
    );
  });

  it("never lets a draft count as accepted", () => {
    for (const versions of Object.values(acceptable)) {
      for (const v of versions) assert.ok(!v.includes("draft"), v);
    }
  });
});
