# Brief for Claude Code: publish the terms, privacy policy and DPA

**From the Legal chat, 2 Oct 2026. Adam pastes this whole document into Claude Code.**

It has four parts: the instructions, then the final text of the three documents. The three texts are Natalie Melia's finals of 23 Sep 2026 with in-house changes approved by Adam on 2 Oct 2026. This document supersedes the wording in `RealComply-terms-update-changes-2-Oct.md` and `RealComply-privacy-DPA-retention-check-2-Oct.md` where they differ (audit trail now keeps names and addresses; backups have no day count; Vercel is Sydney).

---

## PART A: Instructions

### What to do

1. Read `AGENTS.md` in the repo first.
2. **Terms and privacy policy in the app.** `src/lib/legal/documents.ts` still serves the 22 August drafts, marked `reviewed: false`, so every acceptance is stamped `-draft`. Replace the terms with Part B and the privacy policy with Part C. Give both a new version (use the date, 2026-10-02, in whatever format the file already uses). Set `reviewed: true` so the draft banner goes and new acceptances are no longer stamped as drafts.
3. **DPA.** Publish Part D as a public page at `/dpa`, served the same way as `/terms` and `/privacy` if the structure allows. Link it from the foot of `/terms` and `/privacy`. It does not need its own acceptance checkbox.
4. **Marketing site privacy page.** `public/privacy.html` (live at `https://realcomply.com.au/privacy.html`) holds an older, different policy. Make it show the same text as Part C, or redirect it to `/privacy`. The URL must keep working when signed out, because Meta's app review uses it.
5. **Existing users.** Check how the app handles a user who accepted an older version. Existing users (today only Cass Property) should be asked to accept the new version on next sign-in. If that is not built, say so and stop. Do not build it without asking Adam.
6. **Show Adam before it goes live.** Deploy to a preview and give Adam the preview links for `/terms`, `/privacy` and `/dpa`. Merge to `main` only after he says yes.

### Rules

- **Do not change any wording** in Parts B, C or D. Not grammar, not spelling, not clause numbers. If something looks wrong, tell Adam.
- Keep the clause numbers exactly as written. They are typed in by hand because cross-references depend on them.
- Do not touch the AML/KYC cards or any product content.
- No secrets in the chat or the code.
- Add this comment at the top of each document in the code:
  `Natalie Melia (Business Depot Legal) final of 23 Sep 2026, with in-house amendments of 2 Oct 2026 approved by Adam Castelnuovo. The amended clauses were not drafted by a lawyer. See claude/RealComply-legal-documents-publish-brief-2-Oct.md.`
- Add this comment where retention or document storage is handled, if there is such a place:
  `REVERSAL 2 Oct 2026 (Adam): source documents are kept for the life of the subscription. Do NOT purge at settlement. They are deleted with everything else 14 days after the subscription ends.`

### One thing to check in the code and report back

Part C says the public website's home page uses Plausible analytics and the Meta pixel. That was true on 19 August. Confirm both are still there. If either is gone, tell Adam so that sentence can be changed.

### Checks before saying it is done

- `/terms`, `/privacy`, `/dpa` and `/privacy.html` all load when signed out.
- The draft banner is gone.
- A test signup records the new version with no `-draft` on it. Use a throwaway address. Never test on Cass Property's subscription.
- Give Adam the two public links for the Stripe customer portal: the terms page and the privacy page.

### Not part of this job (already on Master's list)

These are described in the documents but not built yet. Customers stay invite-only until they are: the records page and download for ended subscriptions, the two emails, the day-14 deletion, the deletion certificate, the 7-year audit trail store, the suspension screen for failed payments with the 90-day long-stop, and the backup expiry rule.

---

## PART B: Terms and Conditions (final text)

# REALCOMPLY TERMS AND CONDITIONS

## 1. General Terms

1.1 These Terms and Conditions (Terms) govern the access and use of the RealComply Platform ('RealComply'), including all applications, websites, portals, software, features, content, tools, products and services made available by RealComply Pty Ltd ACN 700 934 792 (the Provider) through RealComply.

1.2 These Terms apply to each Subscriber, Licensee in Charge and User, and any other person who accesses or uses RealComply.

1.3 These Terms replace any existing terms agreed between the Parties and apply to all agreements (including any existing arrangements at the date of this agreement) for the supply of Services to the Users and the access and use RealComply.

1.4 By using RealComply or any Services offered by RealComply, all User's represent and affirm that they have read, understood and agree to be bound by these Terms.

1.5 The Subscriber must ensure that, where applicable, each Licensee in Charge, User and any other person who accesses or uses the Services on the Subscriber's behalf has read, understood and agrees to comply with these Terms.

1.6 All defined terms in these Terms have the meaning given to them in the definitions outlined in clause 25.

## 2. Variation

2.1 The Provider may elect to modify, amend, alter, delete or replace these Terms at any time.

2.2 If the Provider elects to rely on this clause 2, the Provider will send a notification to every User to their nominated email address that was used to create an account on the RealComply.

2.3 If a User does not accept the variation of these Terms they must notify RealComply within 30 days failing which a User agrees to any updated terms by continuing to use RealComply.

## 3. Relationship between the Provider and the User

3.1 These Terms apply to a User's access to and use of the Services.

3.2 Every User acknowledges that the Provider does not provide the Services but provides RealComply which allows Subscribers use the Services.

3.3 These Terms do not create any agency, partnership, employee/employer contract, joint venture, conjunctional agent, contractor relationship between the Provider and any Subscriber, where applicable, its Licensee in Charge or User.

## 4. RealComply Account and Subscriptions

4.1 Each Subscriber must create an account to have access to the Services on the RealComply.

4.2 On the creation of a User Account, the Subscriber must select which package they wish to be subscribed to. These may be changed at the discretion of the Provider from time to time in accordance with clause 2.3, which includes a price increase and credit offering for the packages.

4.3 The Provider may offer a 14 day trial period and to access such trial the Subscriber will be required to enter their payment details.

4.4 The Subscriber acknowledges that upon the lapsing of such trial:

(a) the package will continue on a paid basis; and

(b) the Subscriber will be sent a reminder email 3 days before the expiry of the trial period advising the date on which the first payment will be taken and the amount of that payment.

4.5 The Subscriber is only entitled to one trial period. A trial period cannot be restarted, extended or obtained again by creating a new account, registering with a different email address, or otherwise attempting to re-register for the Services.

4.6 The updated and latest packages will be available for viewing on the Provider's website.

4.7 The Subscriber acknowledges and agrees that the payment plans for the packages are as follows:

(a) on a monthly contract, paid month to month, with the first payment due on the day the package is selected; or

(b) on a yearly contract, paid upfront for the entire year; or

(c) any other offering provided by the Provider, at the discretion of the Provider.

## 5. Subscription Additional Terms

5.1 Once a Subscriber selects an offered package on RealComply to access the Services, then the Subscriber must select the payment plan for such package as specified in clause 4.7 or such other packages as added or varied from time to time.

5.2 A Subscriber may cancel or deactivate their subscription at any time. If this occurs:

(a) if the Subscriber paid the yearly subscription fee upfront, the Provider will refund the unused part of that fee. The refund is the amount paid, less the months used (including the current month) charged at the monthly price for the Subscriber's package. If there is no balance, no refund is payable. Refunds are made to the original payment method within 10 Business Days; or

(b) if the Subscriber is on a month-to-month payment plan, then Subscriber's access will end on the last date of applicable month. The Subscriber acknowledges they will be liable to pay the subscription fees for that month despite when the cancellation or deactivation date falls. What happens to the Subscriber's User Content after the subscription ends is set out in clause 18.

5.3 If a Subscriber subscribes to a package they acknowledge and agree that once the Subscriber has selected a package and entered into such contract then the package plan is binding on the Subscriber.

5.4 A Subscriber only has the right to use RealComply by paying the subscription fee relevant to the selected package they have subscribed to.

5.5 Nothing in these Terms excludes, restricts or modifies any right or remedy the Subscriber has under the Australian Consumer Law.

## 6. Abandonment or Cancellation

6.1 If a Subscriber deactivates or deletes their Account, then all active Services will be cancelled and recalled.

6.2 If a Subscriber is inactive on their Account or stops using RealComply the Subscriber's data uploaded to their Account and User Content will be retained, archived and deleted in accordance with the Privacy Policy and clause 18.

6.3 The Provider may cancel a Subscribers account on 30 days notice in writing in which case a pro rata refund for any amounts paid will be provided to the User.

6.4 The Provider reserves the right to cancel a Subscriber's account and delete or deactivate their package and subscription immediately if:

(a) the Subscriber is falsifying compliance records by way of backdating any reviews, recording verification or checks that never occurred or is fabricating evidence for a price representation;

(b) the Subscriber is sharing, reselling or transferring any access to any other party;

(c) the Subscriber attempts to access or use any other persons data; or

(d) the Subscriber's access has remained suspended for 90 days under clause 10.2.

6.5 If the Provider relies on clause 6.4, then the Subscriber acknowledges and agrees that they have no right to receive any refund of any monetary amounts paid in advance (or have the ability to not pay the future monthly payments to the remainder of the yearly subscription contract).

## 7. The Provider Packages

7.1 Once the Subscriber has subscribed to a package, the Subscriber acknowledges that each package is allocated a maximum number of properties, or a range of properties, that may be managed through the Services during the subscription period, as specified in the Subscriber's selected package.

7.2 The Subscribers package is defined by listing volumes over a 12 month rolling window, if a Subscribers listings sit below the package they are subscribed for they will only be charged for the appropriate package, based on the listings.

7.3 The Subscriber will be notified at least 7 days prior to the next billing date when they are approaching their package limit and notified of the next package available to them and associated costs of the same which will take effect from the next billing date.

7.4 The Subscriber need not accept the package upgrade and may notify RealComply at any time before the next billing date that they do not wish to upgrade their package.

## 8. The Services

8.1 The Services are intended to assist the Subscriber in managing their compliance obligations by facilitating record keeping, monitoring deadlines, uploading documents, organising compliance information and highlighting matters that may require further review.

8.2 The Subscriber agrees to not assert any copyright claim or other intellectual property claim or right in forms, data, information or otherwise that the Subscriber builds or creates in using RealComply and Services, and the Subscriber waives any such legal claims against the Provider in relation to anything uploaded to RealComply.

## 9. Restrictions on RealComply

9.1 All Subscribers assume full responsibility for the use of the Services on RealComply.

9.2 You must not share your log in credentials or passwords or allow anyone else to use or access the Services using your account.

9.3 All User's agree that in using the Services and RealComply they will comply with all applicable laws and regulations. This means not violating any laws, legal rights including third party privacy rights or intellectual property rights.

9.4 The Subscriber acknowledge and agree that the Services or RealComply must not be used in connection with any of the following:

(a) any type of illegal activity or crime including any activity that breaches applicable anti-money laundering, counter-terrorism financing, sanctions, anti-bribery or anti-corruption laws;

(b) to infringe any person's privacy, confidentiality, intellectual property or other legal rights;

(c) uploading, storing, transmitting or sharing unlawful, abusive, threatening, defamatory, obscene or otherwise inappropriate content.

9.5 All User's acknowledge and agree that the Provider is not responsible for how User's engage with the Services or RealComply.

9.6 The Provider does not permit any unlawful activities on RealComply and all Users will release the Provider from any liability, damage, injury or death arising out of (whether directly or indirectly) any User breaching this clause 9.

9.7 The Subscriber must not, and must ensure its Users do not:

(a) copy, reproduce, adapt or create derivative works from RealComply or the Services, except as these Terms allow;

(b) reverse engineer, decompile or disassemble RealComply, or try to discover its source code, rules, prompts or structure, except to the extent the law allows this despite this clause;

(c) use any scraper, robot or other automated means to access, extract or copy content from RealComply;

(d) access or use RealComply, or anything it produces, to build, train, improve or assist a product or service that competes with RealComply, or give access to anyone else for that purpose;

(e) remove or alter any copyright or ownership notice.

9.8 Nothing in clause 9.7 limits the Subscriber's right to download, keep and use its own User Content and compliance records for its own business, including giving them to a regulator, auditor or adviser.

9.9 Clauses 9.7 and 9.8 continue after the subscription ends.

## 10. Stripe

10.1 RealComply uses Stripe to collect payments.

10.2 If a payment fails, the Provider will notify the Subscriber, and the Subscriber may keep using RealComply for up to 14 days while the payment is tried again. If it is still unpaid after 14 days, the Provider will suspend the Subscriber's access. While access is suspended, the Subscriber can sign in only to update its payment details and pay, or to cancel its subscription. Months during which access is suspended are not charged. If the Subscriber cancels, clause 18 applies. If access stays suspended for 90 days, the Provider will treat the subscription as cancelled and email the Subscriber and its Licensee in Charge, and clause 18 then applies.

10.3 The User acknowledges that RealComply does not hold or store payment details. Stripe's privacy policy can be found at https://stripe.com/au/privacy.

## 11. The Provider Obligations

11.1 The Provider must:

(a) make RealComply available to the Subscriber during their subscription period, subject to scheduled maintenance, outages and this Agreement;

(b) use reasonable efforts to maintain the security and functionality of RealComply;

(c) investigate and respond to reports of material defects, errors or issues affecting the operation of RealComply within a reasonable time; and

(d) use reasonable efforts to correct verified defects or provide a workaround where reasonably practicable.

## 12. No guarantee

12.1 The Subscriber acknowledges and agrees that:

(a) the Services are an administrative and compliance management and diligence assistance tool only;

(b) the Services do not provide legal advice, regulatory advice, financial advice, compliance certification, regulatory approval or any professional advice;

(c) the Provider does not warrant or guarantee that the use of the Services will ensure compliance with any law, regulation, industry code or regulatory requirement;

(d) the Services use automated and artificial intelligence processing to extract information from documents the Subscriber uploads and information extracted in this way may be inaccurate, incomplete or out of date;

(e) the Subscriber and, where applicable, its the Licensee in Charge must verify all information extracted through the automated and artificial intelligence technologies referred to in clause 12.1(d) against the relevant source documents before relying on, using or acting upon that information;

(f) to the maximum extent permitted by law, the Provider makes no representation, warranty or guarantee as to the accuracy, completeness, reliability or currency of any information generated or extracted through such automated or artificial intelligence processes;

(g) the Subscriber and, where applicable, its Licensee in Charge remains solely responsible for verifying information, exercising its own professional judgment and complying with all applicable laws, regulations and licensing obligations; and

(h) the Provider is not responsible for any failure by the Subscriber, its personnel or users to comply with any applicable law, regulation or regulatory requirement.

## 13. Subscriber Obligations

13.1 The Subscriber understands and agrees that:

(a) RealComply is an administrative and diligence-support tool only. The Subscriber and, where applicable, its Licensee in Charge and the Subscriber remain responsible for all compliance decisions, approvals, disclosures, regulatory obligations and compliance outcomes. The Provider does not assume any regulatory responsibilities of the Subscriber, and, where applicable, its Licensee in Charge or its personnel.

(b) they retain sole responsibility for managing its business operations, supervising its personnel, maintaining compliance with all applicable laws, verifying the accuracy and completeness of information entered into the RealComply, reviewing all outputs generated by the Services. Any alerts, recommendations, reports or findings generated by the Services are intended to assist the Subscriber's or, where applicable, its Licensee in Charges' review processes and must not be relied upon as a substitute for independent professional advice or human oversight.

(c) they are responsible for obtaining any legal, compliance, accounting or other professional advice it considers necessary and for ensuring that, where applicable, their a Licensee in Charge reviews and approves all decisions and actions taken in reliance on the Services.

(d) the Subscriber is responsible for all acts and omissions of, where applicable, its Licensees in Charge and Users in connection with the Services and remains liable for any breach of these Terms by any such person.

(e) they release, indemnify and hold harmless the Provider from any and all loss, defamation, crime liability, injury, death, damage, or costs arising or in any way related to the Services.

(f) they will comply with these Terms (including any new Terms adopted), post accurate information on RealComply, abide by all laws and legislations or in no way engage in any criminal, illegal or immoral activity on RealComply.

(g) they will not give their RealComply access to anyone else, nor allow any other individual to complete Services on their behalf. This includes transferring or selling your account to another person. You must notify the Provider immediately if for any reason you lose access to your account on RealComply or suspect another person is using your account.

13.2 The Provider reserve the right to remove any content, Service or otherwise on RealComply, suspend or cancel any accounts if they reasonably believe any obligation or term has been breached under the Terms.

## 14. The Provider Fees

14.1 A Subscriber's right to use the RealComply depends on the User's timely payment of the relevant Subscription Fee.

14.2 The Subscriber is bound to pay the Subscription Fee in accordance with these Terms.

14.3 All fees and charges under these Terms include GST and a tax invoice will be provided to the Subscriber.

14.4 For the avoidance of doubt, the Subscriber provides authorisation for the Provider to collect the Subscription Fee until such time as the subscription is cancelled or terminated in accordance with these terms.

## 15. User Content

15.1 The Subscriber accepts and agrees that the Subscriber has sole responsibility for the User Content that uploaded to, stored in or processed through RealComply by the Subscriber or its Users.

15.2 The Subscriber warrants that it has all necessary rights, permissions and consents required to upload, store, process and use the User Content in connection with the Services.

15.3 The Subscriber and, where applicable, its Licensee in Charge, as applicable, warrants that they have the authority to use RealComply in connection with the listings and documents they enter into it.

15.4 The Subscriber agrees that, where applicable, its Licensee in Charge remains solely responsible for the accuracy, quality, integrity and legality of all User Content and for its compliance with applicable laws.

## 16. The Provider Proprietary Rights

16.1 All right, title and interest in and to the RealComply and the Provider Website, the Services, all tools and applications in the RealComply and other content and materials related thereto and the technology and infrastructure used to provide them, are proprietary to the Provider and shall at all times remain the sole and exclusive property of the Provider and are protected by applicable intellectual property laws.

16.2 The Subscriber acknowledges that all data and information related to the RealComply or collected by way of the Services through RealComply, excluding User Content that is the responsibility of the person from who such User Content originated, is the sole and exclusive property of the Provider. The Subscriber acknowledges that it does not acquire any ownership rights in or to the Services.

16.3 In these Terms, intellectual property means any form of intellectual property capable of being granted protection at law including, but not limited to registered and unregistered trade marks, patents, designs, trade secrets, drawings, reports, calculations and other deliverables.

16.4 Any intellectual owned by the Provider will remain the property of the Provider and the User acknowledges that nothing in these Terms will be construed as transferring title in or ownership of any intellectual property to the User.

## 17. Privacy

17.1 The Provider will collect, use, disclose, store and otherwise process personal information in accordance with its Privacy Policy and applicable Privacy Laws.

17.2 The Subscriber acknowledges and agrees that the Provider may access, use, process, store and disclose personal information and User Content to the extent reasonably necessary to:

(a) provide, maintain and support RealComply;

(b) perform its obligations and exercise its rights under this Agreement;

(c) comply with applicable laws, regulations or lawful directions of governmental, regulatory or law enforcement authorities; and

(d) protect the security, integrity and operation of the RealComply.

17.3 The Subscriber must ensure that it has obtained all necessary consents and provided all notices required under applicable Privacy Laws in connection with the collection, use, disclosure and processing of personal information through RealComply.

17.4 Each party must comply with all applicable Privacy Laws in connection with the performance of its obligations under this Agreement.

17.5 The Subscriber acknowledges that it is solely responsible for the accuracy, quality, legality and lawful collection and use of any personal information uploaded to or processed through RealComply.

17.6 The Provider does not verify the accuracy, completeness or authenticity of any personal information or other information uploaded to RealComply and is not liable for any loss arising from inaccurate, incomplete or misleading information provided by the Subscriber or its Users.

17.7 All Users must comply with Privacy Laws when using RealComply and must keep Confidential Information confidential. This does not stop a Subscriber using or disclosing its own User Content, or disclosing information where the law requires it or to its professional advisers. The Provider will keep the Subscriber's Confidential Information confidential, except as these Terms, the Privacy Policy or the law allow.

## 18. Data Protection and Data Retention

18.1 The Provider will implement and maintain reasonable technical and organisational measures designed to protect User Content and personal information against unauthorised access, use, disclosure, loss or destruction.

18.2 The Subscriber acknowledges and agrees that the Provider may engage third-party service providers, including hosting, email, data storage, analytics and artificial intelligence service providers, in connection with the Services and provision of the RealComply including Anthropic and Google.

18.3 The Provider will notify the Subscriber as soon as reasonably practicable after becoming aware of a data breach affecting the Subscriber's personal information or the User Content where notification is required by applicable Privacy Laws.

18.4 The Provider will retain User Content and personal information in accordance with its Privacy Policy and applicable laws.

18.5 Upon the termination, suspension or closure of a Subscriber's account, or the cessation of the Services to the Subscriber, the Provider may retain, archive, delete or de-identify all or any part of the User Content and personal information in accordance with its Privacy Policy, applicable laws and the Provider's legitimate business requirements. This clause is subject to clauses 18.6 to 18.11.

18.6 When a subscription ends, the Subscriber can no longer use the Services, but may take a copy of its User Content as set out in this clause.

18.7 For 14 days after the subscription ends, the Subscriber may sign in to a records page and download a complete copy of its User Content, including the finalised compliance record for each listing, its registers and the documents it uploaded. The Provider will email the Subscriber and its Licensee in Charge when the subscription ends, and again 7 days before the User Content is deleted.

18.8 After those 14 days, the Provider will permanently delete the User Content from its systems. Copies held in the Provider's backups are deleted as those backups expire. A Subscriber who resubscribes after deletion starts with an empty account.

18.9 The Provider keeps an audit trail of activity on the account (what was recorded, what RealComply prompted, sign-offs, who did them and when, including the names of Users and property addresses) for 7 years after the subscription ends, to deal with any dispute or claim, respond to regulators and meet its legal obligations. The audit trail does not include the documents the Subscriber uploaded. The Provider will give the Subscriber a copy of it on written request.

18.10 The Subscriber is responsible for keeping the records the law requires it to keep, for as long as the law requires. The Subscriber should download its User Content before the 14 days ends. RealComply is not the Subscriber's record-keeping system after the subscription ends.

18.11 After the subscription ends, the records page may be used only to retrieve the Subscriber's own User Content.

18.12 Clauses 18.6 to 18.11 prevail over clause 18.5 and the Privacy Policy to the extent of any inconsistency.

## 19. Limitation Of Liability

19.1 To the maximum extent permitted by law:

(a) the Provider is not liable for any loss, damage, crime, defamation whether such loss or damage is actual, direct, indirect or consequential, of all kind and nature, whether known or unknown (disclosed or undisclosed), arising from or out of, in any way anything connected with any Services created.

(b) the Provider is not liable or responsible for any loss, damage, expense or consequential loss suffered by any User or third party arising in any way out of, or connected with the Provider or the RealComply.

(c) the Provider is not liable for any resupplying, replacing, repairing or amending any Services being provided, whether or not they are provided at an unsatisfactory standard or not, including whether or not a breach has occurred.

19.2 The Services provided by the Provider disclaims all implied representations and warranties, including (without limitation) any implied warranty, fitness for a particular purpose and non-infringement of third-party rights to the maximum extent permitted by law.

19.3 To the extent RealComply is liable for any loss this is limited to the subscription fees paid by the Subscriber in the preceding 12 months.

## 20. Indemnity

20.1 Each Subscriber indemnifies the Provider from any and all lawsuits (including those brought by third parties) arising out of your engagement with the Services and RealComply or your use, collection or disclosure of any data or information on the RealComply.

## 21. Disclaimer of Third Party Content

21.1 The Provider does not review, verify or endorse the accuracy, completeness, authenticity or legality of any User Content uploaded to RealComply. The Subscriber and, where applicable, the its Licensee in Charge remains solely responsible for all User Content uploaded to or processed through RealComply.

21.2 The Subscriber further understand that the Services may include certain communications from the Provider that the Subscriber cannot opt out of receiving.

## 22. Other Provisions

22.1 A User may not display or use the RealComply trademark or logo without prior written consent from the Provider.

22.2 A Subscriber must not suggest or otherwise falsely appear to be affiliated with the Provider.

22.3 A Subscriber may not assignment any or all of their rights or obligations under these Terms without the prior written consent of the Provider.

## 23. Miscellaneous

23.1 The Provider's failure to enforce any of these Terms will not be construed as a waiver of any of the Provider's rights.

23.2 If any of these Terms are unenforceable, it will be read down to be enforceable or, if it cannot be read down, the term will be severed from these Terms without affecting the enforceability of the remaining Terms.

23.3 A notice must be in writing and handed personally or sent by fax, email or prepaid mail to the addressee. Notices sent by mail are deemed to be received 5 days after posting.

23.4 Notices sent by email are deemed received on confirmation of transmission.

23.5 The User acknowledges that no oral terms or representations form part of these Terms.

23.6 The law of NSW from time to time governs these Terms.

23.7 To the extent of any discrepancy between these Terms and any third party (including the User's own) Terms, these Terms prevail.

23.8 These Terms constitute the entire agreement between the parties and no amendment or variation will be of any force and effect unless the Provider elects, at its full discretion to do so in accordance with clause 2 of these Terms.

23.9 The Provider will not be liable for any loss or damage suffered by a User due to any delay or any breach or default under these Terms in circumstances where such delay, breach or default results from causes beyond the Provider's control including but not limited to acts of God, fires, flood, adverse weather, strikes, lockouts, factory shutdowns or alterations, embargoes, wars, riots, delay or shortage in transportation.

23.10 The Provider shall be under no liability whatsoever to the User for any indirect and/or consequential loss and/or expense (including loss of profit) suffered by the User arising out of a breach by another User of these terms and conditions.

23.11 The Provider may license or sub-contract all or any part of its rights and obligations on 30 days written notice to the Subscriber.

23.12 The failure by the Provider to enforce any provision of these Terms shall not be treated as a waiver of that provision, nor shall it affect the Provider's right to subsequently enforce that provision.

23.13 The provisions of these Terms are severable and if any provision or clause in these Terms are held to be unenforceable or invalid then such provision may be removed or deleted and the remaining terms and provisions will be enforceable on the parties.

23.14 These Terms set out the entire agreement between the User and the Provider.

## 24. Interpretation

24.1 In these Terms, if any provision of these Terms is ambiguous, it is to be interpreted broadly to widen and not restrict the provisions, and, unless the context otherwise requires:

(a) headings and boldings are for convenience only and do not affect the interpretation of this document;

(b) words importing the singular include the plural and vice versa;

(c) words importing a gender include any gender and neutral gender;

(d) other parts of speech and grammatical forms of a word or phrase defined in this document have a corresponding meaning;

(e) an expression importing a natural person includes any company or form of corporation, trust or trustee, partnership, joint venture, association, unincorporated body, Governmental Agency or any other entity, regardless of whether it is considered a separate legal entity;

(f) a reference to 'month' means a calendar month;

(g) any reference to a time in Australian eastern standard time;

(h) any reference to 'dollars' or '$' refers to the lawful currency of the Commonwealth of Australia;

(i) a reference to any thing [including, but not limited to, any right] includes a part of that thing but nothing in this clause implies that performance of part of an obligation constitutes performance of the obligation;

(j) a reference to a clause, party, annexure, exhibit or schedule is a reference to a clause of, and a party, annexure, exhibit and schedule to, this document and a reference to this document includes a reference to the background and any annexure, exhibit and schedule;

(k) a reference to a statute, regulation, proclamation, ordinance, law or by law includes all statutes, regulations, proclamations, ordinances or by laws amending, consolidating or replacing it, and a reference to a statute includes all regulations, proclamations, ordinances and by laws issued under that statute;

(l) a reference to a document includes all amendments, variations or supplements to, replacements or novations of, that document;

(m) a reference to a party to a document includes that party's successors, LPR and permitted assigns;

(n) an obligation or warranty on the part of 2 or more persons binds them jointly and severally and an obligation or warranty in favour of 2 or more persons benefits them jointly and severally;

(o) a reference to an agreement other than this document includes any encumbrance, guarantee, undertaking, deed, agreement or legally enforceable arrangement or understanding whether or not in writing;

(p) a reference to an asset includes all property of any nature, as well as a business, and all rights, revenues and benefits;

(q) a reference to a document includes an agreement in writing, or any certificate, notice, instrument or other document of any kind; and

(r) a reference to writing includes typing, copying, printing, facsimile, and any other manner of representing words, symbols, drawings, figures or diagrams in electronically or in a manner that is visible and tangible.

24.2 Each party acknowledges that it has read and understood this document and has had the opportunity to obtain independent financial and legal advice about its terms.

## 25. Definitions

**Business Day** means a day which is not a weekend or public holiday in New South Wales, Australia.

**Claim** means any claim, action, proceeding, damage, loss, cost, expense or liability of any nature whatsoever [whether actual, contingent or prospective].

**Confidential Information** means: (a) all information uploaded to RealComply by the Subscriber or a User; (b) all information of the Provider, including any intellectual property of the Provider; and (c) all information which at law would be considered secret or confidential, whether or not marked 'confidential'; but does not include information in the public domain.

**Licensee in Charge** means, where the Subscriber is a real estate agency, the individual who holds the relevant licence and is responsible for reviewing, approving and signing off compliance matters within RealComply.

**Parties** means the Provider and the Subscriber.

**Privacy Laws** means the Privacy Act 1988 (Cth) and any rules, regulations or principals created, enacted or enforced pursuant to that act.

**Privacy Policy** means the privacy policy of the Provider available on RealComply.

**Services** means the compliance management and diligence assistance tools, document analysis functionality, reporting features, workflow automation tools, alerts, notifications, application programming interfaces (APIs), associated documentation, and any updates, enhancements or related services made available by the Provider from time to time.

**Stripe** means the payment processing platform known as stripe.

**Subscriber** means real estate agency, business or an individual licensed agent contracting in their own name or ABN that subscribes to RealComply.

**Subscription Fee** means the monthly or yearly subscription fee payable by the Subscriber for engaging in the Services based on the package selected by the Subscriber.

**Terms** means these terms and conditions, which includes any variations.

**The Provider Website** means https://www.realcomply.com.au/ which may be updated from time to time.

**User** means the Subscriber or any individual authorised by a Subscriber to access and use the RealComply on the Subscriber's behalf, including a Licensee in Charge (where applicable), principal, agent, employee, contractor or other authorised personnel.

**User Content** means any information, data, client records, documents, compliance records, forms, files, text, images, reports and other content uploaded to, stored in, submitted through or generated using the RealComply by or on behalf of the Subscriber or its Users.

---

## PART C: Privacy Policy (final text)

# Privacy Policy

RealComply Pty Ltd ACN 700 934 792

## Who we are

RealComply is operated by RealComply Pty Ltd ACN 700 934 792 from New South Wales, Australia. This policy explains what personal information we handle and why.

## What we collect

### About you and your staff

Names, email addresses, agency details, licence and certificate of registration numbers, training and CPD records, and the actions taken in the product, including who signed off what, and when.

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

The home page of our public website uses Plausible, a cookieless analytics tool, to count visits, and the Meta pixel, to measure our advertising. Neither is used inside the product.

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

For as long as you or your agency holds an account. That includes the documents you upload, which we keep for as long as your subscription runs. When a subscription ends or a trial lapses without converting, you can no longer use the product, but for 14 days you can sign in to a records page and download a complete copy of your records. After that we permanently delete them. Copies held in our backups are deleted as those backups expire. We issue a certificate recording the categories and counts of what was deleted. We keep only a record of what checks were run, what was signed off, who did it and when, including user names and property addresses but not the documents you uploaded. We keep that record for seven years after the subscription ends, to deal with any dispute or claim, respond to regulators and meet our legal obligations.

## Security

We implement reasonable technical and organisational measures to protect personal information from misuse, interference, loss, unauthorised access, modification and disclosure. Access is restricted to your own agency's records, enforced in the database rather than only in the application. Data is encrypted in transit. Access by RealComply personnel is limited to those who require it and is subject to written confidentiality obligations.

## Access, correction and complaints

You may ask what personal information we hold about you, ask us to correct it, or complain about how we have handled it, by contacting admin@realcomply.com.au.

We will acknowledge receipt of your complaint within a reasonable time and may request additional information from you to assist with our investigation. Your complaint will be reviewed by the appropriate person within our organisation and we will take such steps as are reasonably necessary to investigate the issues raised.

We aim to respond to complaints within 30 days of receiving all necessary information. Following our investigation, we will notify you of the outcome of your complaint and any actions we propose to take to address it.

If you are not satisfied with our response you may complain to the Office of the Australian Information Commissioner.

## Changes

If this policy changes materially we will publish a new version and record your acceptance of it.

---

## PART D: Data Processing Agreement (final text)

# Data Processing Agreement

RealComply Pty Ltd ACN 700 934 792 and the Subscriber

## 1. Parties and scope

This Agreement is between RealComply Pty Ltd ACN 700 934 792 (RealComply) and the subscriber identified in the Reference Schedule or in the RealComply platform (the Subscriber).

It applies to all Personal Information that RealComply handles on the Subscriber's behalf in connection with the RealComply platform, and supplements the RealComply Terms and Conditions. Where this Agreement and the Terms conflict on the handling of Personal Information, this Agreement prevails.

## 2. Definitions

Personal Information has the meaning given in the Privacy Act 1988 (Cth).

Subscriber Data means all data the Subscriber or its Users upload to, enter into, or generate through the platform, including Personal Information about the Subscriber's own clients and personnel.

Eligible Data Breach has the meaning given in Part IIIC of the Privacy Act 1988 (Cth).

APPs means the Australian Privacy Principles in Schedule 1 of the Privacy Act 1988 (Cth).

Subprocessor means a third party engaged by RealComply that handles Subscriber Data, as listed in Annexure B.

## 3. Roles

The Subscriber determines what Personal Information is entered into the platform, from whom it is collected, and for what purpose. The Subscriber is responsible for the lawfulness of that collection and for its own obligations to the individuals concerned.

RealComply handles Subscriber Data as custodian, for the purpose of providing the platform and for no other purpose, except as set out in clause 4.1.

## 4. RealComply's obligations

### 4.1 Purpose limitation

RealComply will handle Subscriber Data only to provide, maintain, secure and support the platform, to comply with law, and as otherwise instructed by the Subscriber. RealComply will not sell, licence, or disclose Subscriber Data for its own commercial purposes, and will not use Subscriber Data to train artificial intelligence models.

### 4.2 Security

RealComply will maintain reasonable technical and organisational measures to protect Subscriber Data, including:

- Tenant isolation enforced at the database layer, not only in application code, so that one subscriber's records are not reachable from another subscriber's session.
- Role-based access within a subscriber's own account, so that an ordinary agent sees only their own listings while agency-wide records are restricted to the licensee in charge.
- Encryption of data in transit.
- Restriction of RealComply personnel access to those who require it, under written confidentiality obligations.

### 4.3 Identity documents

RealComply does not store copies of identity documents. The platform rejects and deletes uploads that appear to be a driver licence, passport, rates notice or title search, and records only that a verification was performed and when. The Subscriber must not attempt to circumvent this.

### 4.4 Subprocessors

The Subscriber consents to RealComply engaging the Subprocessors listed in Annexure B. RealComply will impose obligations on each Subprocessor substantially equivalent to those in this Agreement, and remains responsible for their acts and omissions. RealComply will give the Subscriber at least 30 days' notice before adding or replacing a Subprocessor that handles Subscriber Data.

### 4.5 Cross-border disclosure

Subscriber Data is held in Australia. Certain Subprocessors identified in Annexure B are located outside Australia. RealComply will take reasonable steps under APP 8.1 to ensure those recipients handle the information consistently with the APPs where necessary.

### 4.6 Assistance

RealComply will provide reasonable assistance, at the Subscriber's cost where the effort is material, to enable the Subscriber to respond to requests from individuals for access to or correction of Personal Information, and to complaints.

### 4.7 Data breach notification

RealComply will notify the Subscriber as soon as practicable, after becoming aware of a data breach affecting Subscriber Data. The notification will describe the nature of the breach, the categories and approximate volume of data affected, the likely consequences, and the steps taken or proposed.

Where the breach may be an Eligible Data Breach, RealComply and the Subscriber will cooperate on the assessment required by s 26WH and agree which entity will notify the OAIC and affected individuals, noting that s 26WM relieves the other of the obligation once one has notified.

### 4.8 Return and deletion

On termination or expiry of the Subscriber's subscription, or on the lapse of a free trial without conversion:

- The Subscriber can no longer use the platform, but for 14 days may sign in to a records page and download a complete copy of its records.
- RealComply will notify the Subscriber and its licensee in charge when the subscription ends, and again 7 days before the records are deleted.
- At the end of the 14 days RealComply will permanently delete Subscriber Data. Copies held in backups are deleted as those backups expire.
- RealComply will issue a deletion certificate recording the categories and counts of records deleted and the date of deletion, and will retain a copy. The certificate will not record the contents of the deleted records.

### 4.9 Retained audit trail

Separately from Subscriber Data, RealComply retains its own audit record of what checks the platform performed, what was flagged, and what was signed off, by whom and when. This record includes the names of the Subscriber's users and property addresses, and does not include uploaded documents. It is kept for seven years from the end of the subscription.

## 5. Subscriber's obligations

The Subscriber warrants and agrees that:

- It has collected all Personal Information it enters into the platform lawfully, and has given the notices and obtained the consents required under the APPs, including in respect of disclosure to RealComply and its Subprocessors.
- It is responsible for the accuracy, quality and legality of Subscriber Data.
- It is responsible for the acts and omissions of its Users, and for managing their access.
- It will not upload copies of identity documents.
- It will not treat the platform as its only copy of a record it is required by law to retain.

## 6. General

This Agreement continues for as long as RealComply holds Subscriber Data. Clauses 4.7, 4.8, 4.9 and 5 survive termination. This Agreement is governed by the law of New South Wales.

## Annexure A: Description of handling

### Categories of individuals

- The Subscriber's personnel: agents, licensees in charge, assistants and administrative staff.
- Vendors and prospective vendors of properties listed by the Subscriber.
- Purchasers and prospective purchasers.
- Tenants, where the Subscriber enters that information.
- Third parties named in documents the Subscriber uploads.

### Categories of Personal Information

- Names, contact details and addresses.
- Licence and certificate of registration numbers, and CPD records.
- Property addresses, price estimates, price representations and advertised prices.
- Transaction details drawn from agency agreements and contracts for sale.
- Complaint records and gift records.
- A record that identity verification was performed, and when, not the underlying document.

### Purposes

- Maintaining the Subscriber's compliance records and evidence trail.
- Extracting figures and dates from uploaded documents for the Subscriber to verify.
- Checking advertised prices against the estimated selling price on file.
- Reminders, review loops and status reporting.
- Producing a finalised compliance file at the conclusion of a matter.

## Annexure B: Subprocessors

| Subprocessor | Service | Location | Data handled |
|---|---|---|---|
| Supabase | Database and document storage | Sydney, Australia | All Subscriber Data |
| Vercel | Application hosting | Sydney, Australia | Transient request data |
| Anthropic PBC | AI extraction of figures and dates from uploaded documents | United States | Text of uploaded documents. Not used for model training. |
| Google LLC | Address autocomplete | United States | Partial address strings typed by users |
| Amazon Web Services (SES) | Transactional email | Sydney, Australia | Names, email addresses, property addresses, compliance status |
