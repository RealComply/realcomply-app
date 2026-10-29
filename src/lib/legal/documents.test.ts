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
// The privacy policy has its own briefs: 16 Oct 2026 (phone numbers added),
// 29 Oct 2026 (website analytics) and 29 Oct 2026 again (no "early access").
const BRIEF = readFileSync(join(process.cwd(), "claude/RealComply-legal-documents-publish-brief-9-Oct.md"), "utf8");
const PRIVACY_BRIEF_16_OCT = readFileSync(join(process.cwd(), "claude/RealComply-privacy-policy-16-Oct.md"), "utf8");
const PRIVACY_BRIEF_29_OCT = readFileSync(join(process.cwd(), "claude/RealComply-privacy-policy-29-Oct.md"), "utf8");
const PRIVACY_BRIEF = readFileSync(join(process.cwd(), "claude/RealComply-privacy-policy-29-Oct-2.md"), "utf8");

function part(startHeading: string, nextHeading: string | null, brief = BRIEF): string {
  const start = brief.indexOf(startHeading);
  assert.ok(start >= 0, `brief is missing "${startHeading}"`);
  const from = start + startHeading.length;
  const to = nextHeading ? brief.indexOf(nextHeading, from) : brief.length;
  return brief.slice(from, to).trim().replace(/\n---$/, "").trim();
}

const EARLY_ACCESS_PARAGRAPH = `### If you register for early access

Your name, agency name and email address, and your phone number if you choose to give it. By giving us your phone number, you agree to us calling you about setting up RealComply.

`;

const PUBLIC_WEBSITE_16_OCT = `### Our public website

The home page of our public website uses Plausible, a cookieless analytics tool, to count visits, and the Meta pixel, to measure our advertising. Neither is used inside the product.`;

const PUBLIC_WEBSITE_29_OCT = `### Our public website

Our home page and legal pages use Vercel Web Analytics, which does not use cookies, to count visits and see which of our links brought them. For each visit it records the page, the tag in our link if there is one (for example, that you came from one of our text messages or emails), the website that referred you, your browser, operating system and type of device, and your country. Nothing else from the web address is recorded.

The home page also uses the Meta pixel, to measure our advertising.

Neither is used inside the product.`;

describe("published legal documents", () => {
  it("terms are Part B of the brief, verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.terms.body, part("## PART B: Terms and Conditions (final text)", "## PART C:"));
  });

  it("privacy policy is Part C of the latest brief (29 Oct, no early access), verbatim", () => {
    assert.equal(LEGAL_DOCUMENTS.privacy.body, part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF));
  });

  it("the latest privacy policy is the 29 Oct one with only the sign-up heading changed, and never says early access", () => {
    const twentyNinthOct = part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF_29_OCT);
    const body = LEGAL_DOCUMENTS.privacy.body;
    assert.ok(twentyNinthOct.includes("### If you register for early access\n"));
    assert.ok(body.includes("### If you sign up on our website\n"));
    assert.ok(!/early access/i.test(body));
    assert.equal(
      body.replace("### If you sign up on our website\n", "### If you register for early access\n"),
      twentyNinthOct,
    );
  });

  it("the 29 Oct privacy policy is the 16 Oct one with only the public website section rewritten", () => {
    const sixteenOct = part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF_16_OCT);
    const twentyNinthOct = part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF_29_OCT);
    assert.ok(sixteenOct.includes(PUBLIC_WEBSITE_16_OCT));
    assert.ok(twentyNinthOct.includes(PUBLIC_WEBSITE_29_OCT));
    assert.ok(!twentyNinthOct.includes("Plausible"));
    assert.equal(twentyNinthOct.replace(PUBLIC_WEBSITE_29_OCT, PUBLIC_WEBSITE_16_OCT), sixteenOct);
  });

  it("the 16 Oct privacy policy is the 9 Oct one plus the phone number words, nothing else", () => {
    const nineOct = part("## PART C: Privacy Policy (final text)", "## PART D:");
    const body = part("## PART C: Privacy Policy (final text)", null, PRIVACY_BRIEF_16_OCT);
    assert.ok(body.includes(EARLY_ACCESS_PARAGRAPH));
    assert.ok(body.includes("Names, email addresses, phone numbers, agency details,"));
    assert.equal(
      body.replace(EARLY_ACCESS_PARAGRAPH, "").replace("email addresses, phone numbers, agency", "email addresses, agency"),
      nineOct,
    );
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

  it("new acceptances record the latest privacy policy", () => {
    assert.equal(current.privacy, "2026-10-29.2");
    assert.equal(current.terms, "2026-10-09");
  });

  it("someone who accepted the 29 Oct policy is not asked again for the heading change", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: "2026-10-09", privacy_version: "2026-10-29" }], acceptable),
      true,
    );
  });

  it("someone who accepted on 16 Oct is not asked again for the 29 Oct privacy change", () => {
    assert.equal(
      acceptsCurrentVersions([{ terms_version: "2026-10-09", privacy_version: "2026-10-16" }], acceptable),
      true,
    );
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
