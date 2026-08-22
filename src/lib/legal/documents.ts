// The published legal documents, and their versions.
//
// Built 22 Aug 2026, ahead of the lawyer's drafts, because the plumbing is the
// slow part and the words are the fast part. When the real documents arrive,
// replace `body` and bump `version`. Nothing else has to change.
//
// WHY A VERSION STRING AT ALL. "The agency accepted our terms" is worth very
// little on its own. What a regulator or a court asks is which terms, as they
// stood when. So every acceptance records the exact version identifier of the
// document that was on screen, and old versions must never be edited in place
// once anyone has accepted them: publish a new version instead. That is the
// whole reason acceptance is stored against a version rather than a boolean.
//
// Versions are dates because that is what people cite in correspondence, and
// a date sorts correctly without anyone having to remember a scheme.

export type LegalDocumentKey = "terms" | "privacy";

export type LegalDocument = {
  key: LegalDocumentKey;
  /** Route path, also the link target in the signup checkbox. */
  path: string;
  title: string;
  /** Bump this whenever the text changes. Never edit a version people accepted. */
  version: string;
  /** Shown under the title so a reader knows which version they are looking at. */
  effective: string;
  /**
   * True once a lawyer has settled the text. While false the page carries a
   * visible notice saying so, because a placeholder that looks like a real
   * policy is worse than an obvious draft: someone will otherwise rely on it.
   */
  reviewed: boolean;
  /** Markdown-ish plain text. Rendered as paragraphs and headings. */
  body: string;
};

const TERMS_BODY = `
## 1. What RealComply is

RealComply is a compliance support tool for real estate agencies in New South Wales. It helps you prepare, maintain and review the records your agency is required to keep.

## 2. What RealComply is not

RealComply does not provide legal advice, and it does not certify that your agency is compliant. It supports the diligence of the people responsible for compliance; it does not replace them.

The licensee in charge remains accountable for the agency's compliance obligations under the Property and Stock Agents Act 2002 (NSW) and every other law that applies to the agency. Where RealComply produces a finding, a draft or a suggestion, it is for a person to review and decide upon. Sign-off in the product is that person's decision, recorded, not the software's.

Nothing in these terms transfers a statutory obligation from the agency or the licensee to RealComply, and nothing in them is capable of doing so.

## 3. Your account and your people

You are responsible for who you invite into your agency's account and for what they do in it. Accounts are personal and must not be shared.

## 4. Your data

Your records remain yours. See the Privacy Policy for what is collected, where it is held, and who else processes it.

## 5. Availability

We aim to keep the service available and to hold your records safely, but we do not warrant uninterrupted availability. You should not treat RealComply as the only copy of a record you are legally required to keep.

## 6. Fees

Where a subscription applies, the fee, the billing period and the notice required to cancel are those set out in your subscription confirmation.

## 7. Liability

Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy under the Australian Consumer Law that cannot lawfully be excluded. Where liability can be limited, ours is limited to resupplying the service or paying the cost of having it resupplied.

## 8. Changes to these terms

If these terms change materially, we will publish a new version and ask you to accept it. The version you accepted, and when, is recorded against your account.

## 9. Governing law

These terms are governed by the law of New South Wales, Australia.
`.trim();

const PRIVACY_BODY = `
## Who we are

RealComply is operated from New South Wales, Australia, and is an APP entity under the Privacy Act 1988 (Cth). This policy explains what personal information we handle and why.

## What we collect

**About you and your staff.** Names, email addresses, agency details, licence and certificate details, training and CPD records, and the actions taken in the product, including who signed off what and when.

**About your listings.** Property addresses, vendor and purchaser names where you enter or upload them, estimated selling prices, and the documents you attach, such as agency agreements, contracts for sale and comparable sales reports.

**Identity verification.** RealComply records that a verification was carried out and when. It is not a place to store copies of identity documents, and the product actively refuses them: an upload that appears to be a licence, passport, rates notice or title search is rejected and deleted rather than stored.

## Why we collect it

To provide the service: maintaining your compliance records, checking your advertised prices against the estimated selling price on file, reminding you of expiries, and producing the finalised file at the end of a matter.

## Where it is held

Your database records and uploaded documents are held in Sydney, Australia.

## Who else processes it

**Anthropic (United States).** Documents you upload are sent to Anthropic's API to be read, so that figures and dates can be extracted for you to check. They are processed to return that result and are not used to train models.

**Google (United States).** Address lookup as you type, when you use it.

**Our email provider.** Notification and digest emails, which contain names, property addresses and compliance status, are sent through a transactional email provider. Where that provider sends from outside Australia, this is a cross-border disclosure under Australian Privacy Principle 8, and we take reasonable steps to ensure the recipient handles the information consistently with the Australian Privacy Principles.

## How long we keep it

For as long as your agency holds an account, and for as long afterwards as record-keeping obligations require. Where the product produces a finalised file for a completed matter, source documents may be purged after you confirm you have downloaded it.

## Security

Access is restricted to your own agency's records, enforced in the database rather than only in the application. We do not currently require multi-factor authentication.

## Access, correction and complaints

You may ask what personal information we hold about you, ask us to correct it, or complain about how we have handled it, by contacting admin@realcomply.com.au. If you are not satisfied with our response you may complain to the Office of the Australian Information Commissioner.

## Changes

If this policy changes materially we will publish a new version and record your acceptance of it.
`.trim();

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    key: "terms",
    path: "/terms",
    title: "Terms of Service",
    version: "2026-08-22-draft",
    effective: "22 August 2026",
    // Flip to true only when a lawyer has settled the text, and bump the
    // version at the same time so the "-draft" suffix stops appearing in
    // acceptance records.
    reviewed: false,
    body: TERMS_BODY,
  },
  privacy: {
    key: "privacy",
    path: "/privacy",
    title: "Privacy Policy",
    version: "2026-08-22-draft",
    effective: "22 August 2026",
    reviewed: false,
    body: PRIVACY_BODY,
  },
};

export function legalDocument(key: LegalDocumentKey): LegalDocument {
  return LEGAL_DOCUMENTS[key];
}

/** The pair recorded against an acceptance. */
export function currentLegalVersions(): { terms: string; privacy: string } {
  return {
    terms: LEGAL_DOCUMENTS.terms.version,
    privacy: LEGAL_DOCUMENTS.privacy.version,
  };
}
