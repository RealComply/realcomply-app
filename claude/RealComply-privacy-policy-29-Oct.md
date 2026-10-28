# Privacy policy change: website analytics

**29 Oct 2026. Requested by Adam with the Vercel Web Analytics job (PR #89). Wording approved by Adam, 29 Oct 2026, for the Legal chat to approve before PR #89 merges.**

One change to the privacy policy of 16 Oct 2026, under "How we collect the personal information": the "Our public website" section.

- Plausible is no longer named. There was never a Plausible account for realcomply.com.au, so it counted nothing, and PR #89 removes it from the website.
- Vercel Web Analytics is added: on the home page and the legal pages, no cookies, and what each visit records.
- The Meta pixel sentence is kept, and "Neither is used inside the product." now closes the section.

Every other word is unchanged. The new words were written in-house at Adam's request. They were not drafted by a lawyer.

Legal approval: pending. Still to check against Vercel's own privacy page: where Vercel holds Web Analytics data (if outside Australia, the Vercel row under "Who else processes it" and the cross-border paragraph change too), and whether it records location more finely than country.

Published as version 2026-10-29. Re-acceptance: Adam to decide. As built, people who accepted version 2026-10-16 or 2026-10-09 are not asked to accept again, as Adam decided for the 16 Oct change. New sign-ups accept 2026-10-29.

`src/lib/legal/documents.test.ts` checks the published privacy policy against Part C below, character for character.

---

## PART C: Privacy Policy (final text)

# Privacy Policy

RealComply Pty Ltd ACN 700 934 792

## Who we are

RealComply is operated by RealComply Pty Ltd ACN 700 934 792 from New South Wales, Australia. This policy explains what personal information we handle and why.

## What we collect

### About you and your staff

Names, email addresses, phone numbers, agency details, licence and certificate of registration numbers, training and CPD records, and the actions taken in the product, including who signed off what, and when.

### If you register for early access

Your name, agency name and email address, and your phone number if you choose to give it. By giving us your phone number, you agree to us calling you about setting up RealComply.

### About your listings and third-party information

Property addresses, vendor and purchaser names where you enter or upload them, estimated selling prices, and the documents you attach, such as agency agreements, contracts for sale and comparable sales reports.

We may collect personal information of third parties indirectly from you, including where you provide information about a third party, parties of property sale, licensee in charge, agent, employee or contractor.

### Identity verification

We record that a verification was carried out and when. We are not a place to store copies of identity documents, and the product actively refuses them: an upload that appears to be a driver licence, passport, rates notice or title search is rejected and deleted rather than stored.

## How we collect the personal information

We collect personal information in the following ways:

- information entered directly by you and authorised users of the RealComply platform;
- information extracted from documents uploaded to the platform by Subscribers or their authorised users;
- information provided by one individual about another individual, including where an agent enters details of a licensee in charge in connection with an individual agent subscription;
- information collected automatically: sign-in records, session data, IP addresses and platform activity logs;
- information from third parties: billing contact details from Stripe including address data and address autocomplete; and
- information that the platform generates rather than collects such as figures extracted from uploaded documents, compliance flags and sign-off records.

### Our public website

Our home page and legal pages use Vercel Web Analytics, which does not use cookies, to count visits and see which of our links brought them. For each visit it records the page, the tag in our link if there is one (for example, that you came from one of our text messages or emails), the website that referred you, your browser, operating system and type of device, and your country. Nothing else from the web address is recorded.

The home page also uses the Meta pixel, to measure our advertising.

Neither is used inside the product.

## Why we collect it

We will not use yours or any third party's personal information for any other purpose than what is outlined below without first seeking their consent, or whether authorised or required by law. We will use the personal information we collect for the purpose disclosed at the time of collection, or otherwise as set out below:

- to establish and maintain relationship with us;
- to process payments;
- to provide the service to our subscribers including maintaining our subscribers' compliance records, checking your advertised prices against the estimated selling price on file, reminding Subscribers of expiries, and producing the finalised file at the end of a matter; and
- to disclose personal information to third parties as set out in this Privacy Policy.

## How we hold the personal information

We hold personal information electronically in databases, records and documents stored through our technology providers.

Your database records and uploaded documents are held in Sydney, Australia.

## Who else processes it

| Who | What for | Where |
|---|---|---|
| Anthropic | Documents you upload are sent to their API to be read, so that figures and dates can be extracted for you to check. They are processed to return that result and are not used to train models. | United States |
| Google | Address lookup as you type, when you use it. | United States |
| Amazon Web Services | Notification and digest emails, which contain names, property addresses and compliance status. | Sydney, Australia |
| Supabase | Database and document storage. | Sydney, Australia |
| Vercel | Application hosting. | Sydney, Australia |

Disclosure to Anthropic and Google involves sending information outside Australia. This is a cross-border disclosure under Australian Privacy Principle 8, and we take reasonable steps to ensure those recipients handle the information consistently with the Australian Privacy Principles.

## How long we keep it

For as long as you or your agency holds an account. That includes the documents you upload, which we keep for as long as your subscription runs. When a subscription ends or a trial lapses without converting, you can no longer use the product, but for 14 days you can sign in to a records page and download a complete copy of your records. After that we permanently delete them. Copies held in our backups are deleted as those backups expire, within 90 days. We issue a certificate recording the categories and counts of what was deleted. We keep only a record of what checks were run, what was signed off, who did it and when, using internal identifiers rather than user names or property addresses, and not the documents you uploaded. We keep that record for seven years after the subscription ends, to deal with any dispute or claim, respond to regulators and meet our legal obligations.

## Security

We implement reasonable technical and organisational measures to protect personal information from misuse, interference, loss, unauthorised access, modification and disclosure. Access is restricted to your own agency's records, enforced in the database rather than only in the application. Data is encrypted in transit. Access by RealComply personnel is limited to those who require it and is subject to written confidentiality obligations.

## Access, correction and complaints

You may ask what personal information we hold about you, ask us to correct it, or complain about how we have handled it, by contacting admin@realcomply.com.au.

We will acknowledge receipt of your complaint within a reasonable time and may request additional information from you to assist with our investigation. Your complaint will be reviewed by the appropriate person within our organisation and we will take such steps as are reasonably necessary to investigate the issues raised.

We aim to respond to complaints within 30 days of receiving all necessary information. Following our investigation, we will notify you of the outcome of your complaint and any actions we propose to take to address it.

If you are not satisfied with our response you may complain to the Office of the Australian Information Commissioner.

## Changes

If this policy changes materially we will publish a new version and record your acceptance of it.
