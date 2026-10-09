# RealComply code review, 9 October 2026

This is a review only. Nothing in the app, the database or the settings was changed. The review read `main` at `fb55691`. Database checks were read-only queries against the live project.

**Levels**
- **Urgent:** a live hole that someone could use today.
- **Before the paying office:** fix before the first paying agency goes live.
- **Soon:** within the next few weeks.
- **Later:** worth doing, not pressing.

**What "checked" means**
- **Confirmed live:** proved on the live database with read-only queries.
- **Read in code:** someone read the code and followed the logic, but did not run it.

**Left out on purpose:** the two queued briefs. These are hardening (upload limits, bootstrap revokes, search_path, function grants) and agent access, which includes invite assistant links.

---

## Urgent

### 1. Any signed-in user can make themselves platform admin or move into another agency
- **Where:** `supabase/migrations/0001_init.sql:174-176` (policy "profiles: users can update their own profile").
- **The cause:**
  - The policy checks only that the row is the user's own.
  - It never checks the new values (there is no `WITH CHECK`).
  - Signed-in users hold UPDATE on every column, including `is_platform_admin`, `agency_id`, `is_licensee_in_charge`, `is_assistant`, `is_agent` and `archived_at`.
  - Neither trigger on the table stops changes to those columns.
- **Checked:** Confirmed live.
- **What could go wrong:**
  - An agent at any office opens the browser console and runs one update on their own profile row: `is_platform_admin = true`. That opens the admin page, which runs with full database rights. From there they can send founder invites, give free plans, set legal holds and use the deletion tools.
  - Or they set `agency_id` to another office's id. They can then read and edit every file at that office.
- **Fix:** Add a BEFORE UPDATE trigger that rejects changes to those columns unless the caller is the service role. Alternatively, revoke UPDATE and grant back only the safe columns (name, phone and similar). Also add `WITH CHECK (id = auth.uid())`.

---

## Before the paying office

### 2. Any agency member can fake a licensee sign-off
- **Where:** `supabase/migrations/0014_licensee_signoff_links.sql:108-123`.
- **Checked:** Confirmed live. Members hold UPDATE on `signed_at` and `signed_name`, and no trigger protects them.
- **What could go wrong:**
  - An agent writes `signed_at = now(), signed_name = 'Jane Licensee'` on their own request row.
  - They then mark `sign_licensee` done on the file.
  - The file shows a link signature the licensee never gave. It looks exactly like a real one, and it is the record you would hand to Fair Trading.
  - The comment in the migration says this cannot happen. The database does not enforce it.
- **Fix:** Revoke UPDATE on `signed_at` and `signed_name` from signed-in users, so only `submit_signoff()` can set them. Add a database check that only the licensee or `submit_signoff()` can complete `sign_licensee`.

### 3. A late or replayed Stripe message can give an ended agency free access forever
- **Where:** `src/app/api/stripe/webhook/route.ts` (the `customer.subscription.*` handling, about lines 120-222).
- **Checked:** Read in code.
- **What could go wrong:**
  - A customer cancels.
  - Stripe sends "updated (active, cancelling)" and then "deleted". The first message failed once, so Stripe retries it after "deleted".
  - The retry sets the agency back to `active`, and the database trigger clears `ended_at`.
  - The agency has full access again with no subscription, and nothing will ever end it.
  - The same thing happens if someone replays an old event from the Stripe dashboard.
- **Fix:** On each subscription event, fetch the subscription fresh from Stripe, as `checkout.session.completed` already does, rather than trusting the copy in the message. Store event ids so each one is applied once.

### 4. A message about an old subscription can hijack the agency's billing link
- **Where:** `src/app/api/stripe/webhook/route.ts:192`.
- **Checked:** Read in code.
- **What could go wrong:**
  - An agency reactivates and gets a new subscription.
  - A late "updated" message about the old one arrives. The stale-message guard only blocks "canceled" messages, so this one gets through and writes the old subscription id back.
  - When the customer later cancels the new subscription, its "deleted" message is ignored as stale. The agency stays `active` and is never billed.
- **Fix:** Ignore every event whose subscription id differs from the one on file, except checkout completion.

### 5. A replaced or failed upload can lose the evidence file
- **Where:** `src/lib/storage/evidence.ts:164-168`.
- **Checked:** Read in code.
- **What could go wrong:**
  - The old file is deleted before the database row is updated.
  - If the update fails, the item points at a file that no longer exists.
  - On every successful replace, the earlier version is gone with no history, even if it was the one a licensee signed against.
- **Fix:** Update the row first and remove the old file only after that succeeds. Better still, keep old versions.

### 6. The listing-page check can be pointed at internal addresses
- **Where:** `src/lib/actions/website-scan.ts:248` (`redirect: "follow"`) and `:194` (`assertSafeUrl`).
- **Checked:** Read in code.
- **What could go wrong:**
  - A user sets a listing URL on a site they control, and that site redirects to `http://169.254.169.254/` or a private address.
  - Redirects are followed without being re-checked.
  - The response status ends up on the card, so it can be used to probe Vercel's internal network.
  - Some forms of address get past the blocklist directly: `[::ffff:127.0.0.1]`, `localhost.` and domains that resolve to private IPs.
  - The check also runs on the daily cron for the agency website address.
- **Fix:** Set `redirect: "manual"` and re-check each hop (up to 3). Resolve the host and refuse private ranges, including IPv6 and IPv4-mapped forms.

### 7. An agency name can plant a link in the sign-off email
- **Where:** `src/lib/email/layout.ts:179` (footer lines are not escaped) and `src/lib/email/signoff-request.ts:112` (the agency name and agent name go into the footer).
- **Checked:** Read in code.
- **What could go wrong:**
  - Someone signs up with an agency name that contains `<a href="https://evil.example">Verify your identity</a>`.
  - Every sign-off request then carries that live link. It is sent from RealComply's domain to an outside licensee who is expecting to click a link and sign.
- **Fix:** Escape footer lines by default and allow raw HTML only for fixed text. Or move the "Sent by…" sentence into an escaped paragraph.

### 8. Known security holes in the Next.js and nodemailer versions in use
- **Where:** `package.json` (`next` 16.3.0, `nodemailer` ^9.0.5).
- **Checked:** `npm audit` reports 1 critical and 11 high.
- **Next.js:**
  - Most of the critical items do not apply on Vercel, because Windows-only and image-optimisation bugs are handled by Vercel.
  - The SSRF and cache-poisoning advisories do apply. They are fixed in 16.3.8 and later.
- **nodemailer:**
  - It has a denial-of-service bug and a bypass of the recipient-domain check. Both are fixed in 10.0.6.
- **Fix:** Upgrade `next` to the latest 16.x and `nodemailer` to 10.0.6 or later. Then run the tests and a preview deploy.

### 9. If a scheduled job fails, nobody is told
- **Where:**
  - `src/app/api/cron/*/route.ts`
  - `src/lib/email/send.ts:156-187`
  - `src/app/api/cron/backup-storage/route.ts:37-41`
- **Checked:** Read in code.
- **The gap:**
  - There is no error tracking: no Sentry, no `instrumentation.ts` and no `error.tsx`.
  - The 7am listing check, the weekly digest, the reminders and the backup all fail silently, or return 200 with zero counts.
  - Email sending never raises an error. If the mail provider breaks, every customer email silently stops.
  - Only the deletion job emails the admin.
- **What could go wrong:** The mail settings change and the price check runs for three weeks without sending an alert. Meanwhile, the homepage promises "we'll let you know".
- **Fix:** Add error tracking. Have each cron email the admin when it fails, or when it finds zero listings on a day it normally finds some.

### 10. The proxy file is in the wrong folder, so it never runs
- **Where:** `proxy.ts` is at the repo root, but the app lives in `src/app`. Next 16 only picks the file up from `src/`.
- **Checked:** Read in code. The file is not at `src/proxy.ts`.
- **What could go wrong:**
  - Pages are still protected one by one (`requireProfile`). But sessions are not refreshed in the background, so people get signed out sooner than expected.
  - Pages outside `/dashboard` don't redirect to login.
  - Anything added to the proxy later, such as security headers, will silently do nothing.
- **Fix:** Move it to `src/proxy.ts` and test sign-in, sign-out and expired sessions on a preview.

### 11. A deletion run that failed can resume and delete too early after a cancel → resubscribe → cancel
- **Where:** `src/lib/subscription-end/deletion.ts:96-105` and `:203-215`.
- **Checked:** Read in code.
- **What could go wrong:**
  - A deletion run fails halfway, for example on an AWS error, and stays open.
  - The customer resubscribes and then cancels again the same day.
  - The next day's run resumes the old job and deletes everything on day 0 of the new 14-day window.
- **Fix:** Store the `ended_at` the run started with, and refuse to resume if it has changed. Or re-check that the 14 days have passed before resuming.

### 12. No automatic checks before code reaches main
- **Where:** There is no `.github/workflows`. There are also no tests for the database security rules, sign-offs, the deletion job, or the webhook beyond `trial_will_end`.
- **Checked:** Read in code.
- **What could go wrong:** Findings 1 and 2 are exactly the kind of mistake a short database-rules test would have caught. Without CI, a broken test or type error can be merged without anyone noticing.
- **Fix:**
  - Add a GitHub Action that runs lint, typecheck and `npm test` on every PR.
  - Add a small set of security-rule tests, such as "an agent cannot change `is_platform_admin`" and "an agent cannot set `signed_at`".

---

## Soon

### 13. A Stripe message can switch off a free (comped) agency
- **Where:** `src/app/api/stripe/webhook/route.ts:199-222` and `src/lib/actions/billing.ts:286-300`.
- **Checked:** Read in code.
- **What could go wrong:**
  - A paying office is switched to free. The old Stripe subscription is not cancelled.
  - Stripe later sends "past_due" or "deleted" for it, and the office goes read-only.
  - The office's records are not deleted, because comped agencies are protected.
- **Fix:** Cancel the Stripe subscription when switching to free, and have the webhook skip comped agencies.

### 14. A revised-ESP figure read by the AI is used without anyone confirming it
- **Where:** `src/lib/actions/extraction.ts:1587-1600`.
- **Checked:** Read in code.
- **What could go wrong:** The AI misreads a revised-ESP notice, for example $650k instead of $750k. Every later underquoting check uses the lower figure, and the "below ESP" alerts go quiet.
- **Fix:** Save it as a draft that the agent confirms, like the other reads.

### 15. Whether the page matches the address is left to the AI alone
- **Where:** `src/lib/actions/website-scan.ts:367` and `:394`.
- **Checked:** Read in code.
- **What could go wrong:**
  - Hidden text on a listing page can make the AI report a price and confirm the address while the visible ad says "Contact agent".
  - That suppresses both red flags.
  - The page text goes into the prompt with nothing marking it as untrusted.
- **Fix:** Also require the street number and street name to appear in the page text. Wrap the page text in tags and tell the model to treat it as data.

### 16. No limit on AI use per user or per agency
- **Where:**
  - `src/lib/actions/legislation-chat.ts`
  - `src/lib/actions/help-chat.ts`
  - `src/lib/actions/website-scan.ts:645` (`checkListingNow`)
- **Checked:** Read in code.
- **What could go wrong:**
  - One signed-in user with a script can send unlimited long questions, or press "Check now" repeatedly, and run up the Anthropic bill.
  - Help-chat escalations email the admin each time, so the admin inbox can be flooded.
  - The daily search for listing pages runs indefinitely for listings that never go online.
- **Fix:** Set a per-agency daily cap, a maximum message length and a cool-down on "Check now". Stop searching for a listing page after a set number of days.

### 17. Anyone can use the address search without signing in
- **Where:** `src/lib/actions/places.ts:28` (`searchAddress`).
- **Checked:** Read in code. The function has no auth check.
- **What could go wrong:** A script calls the server action in a loop and uses up the Google Places quota or bill.
- **Fix:** Call `requireAuthContext()` first. Set a daily cap on the Google key.

### 18. Agency invite links never expire
- **Where:** `agency_invites` (migration 0006) and `accept_invite` (`0025:184-250`).
- **Checked:** Read in code.
- **What could go wrong:**
  - An old invite email is forwarded or leaked.
  - Months later someone uses it to register as that address and joins the office. Email confirmation is off, so they never have to prove they own the address.
  - Opening the link also shows the email address, agency name and role to anyone who has it.
- **Fix:** Add `expires_at` (for example 14 days) and check it in `accept_invite` and in the preview.

### 19. Raw database errors are shown to users and on the public health check
- **Where:**
  - `src/app/api/health/route.ts:63-71`
  - `src/lib/actions/auth.ts:37, 206, 243`
  - about 13 places in `compliance.ts`
  - `storage/evidence.ts:135, 182, 192`
- **Checked:** Read in code.
- **What could go wrong:**
  - Signed-out visitors to `/api/health` see the first 200 characters of a database error.
  - Sign-up says "User already registered", which tells anyone whether an email has an account.
  - Users see table and column names in error messages.
- **Fix:** Show a plain message to users and keep the detail in the logs. Have `/api/health` return only OK or not-OK.

### 20. Personal details are written to the logs
- **Where:**
  - `src/lib/email/send.ts:180-185`: the recipient, and the subject line, which carries names and addresses.
  - `help-chat.ts:212`: name, email and the full question.
  - `early-access.ts:130, 153, 179` and `unsubscribe/route.ts:97, 99`: email addresses.
  - `extraction.ts:896, 1026, 1172`: file names such as "John Smith passport.pdf".
- **Checked:** Read in code.
- **What could go wrong:** Vercel logs keep personal information and ID document names that the product promises not to keep.
- **Fix:** Log ids or a hash in place of emails, and drop subjects and file names.

### 21. The daily check can't reopen the revision question
- **Where:** `src/lib/actions/compliance.ts:2308-2309`, called from `website-scan.ts:577`.
- **Checked:** Read in code. The function uses the signed-in client, and the cron has no signed-in user.
- **What could go wrong:** A listing's advertised price moves but the file still says "no revision". The daily run finds nothing to reopen, so the question is only asked again when someone presses "Check now".
- **Fix:** Pass the cron's service client through, with an agency check, rather than creating a client inside the function.

### 22. The daily listing check can run out of time and hides database errors
- **Where:** `src/lib/actions/website-scan.ts:705-714` and `src/app/api/cron/listing-scan/route.ts` (no `maxDuration`).
- **Checked:** Read in code.
- **What could go wrong:**
  - It checks one listing at a time, and each can take up to 15 seconds plus the AI read.
  - With enough listings, the run is cut off and the rest are skipped.
  - A failed query looks like "0 listings".
- **Fix:** Set `maxDuration` and process listings in batches, oldest-checked first. Treat a query error as a failure.

### 23. Listing pages are downloaded with no size limit
- **Where:** `src/lib/actions/website-scan.ts:257` (`res.text()`).
- **Checked:** Read in code.
- **What could go wrong:** A huge or endless page can exhaust the function's memory and take down the daily run for everyone.
- **Fix:** Stop reading after about 3 MB and require an HTML content type.

### 24. No security headers, and sign-off links can leak through the Referer header
- **Where:** `next.config` has no headers block, and `proxy.ts` does not run (finding 10).
- **Checked:** Read in code.
- **What could go wrong:**
  - The site can be framed by another site.
  - A sign-off link (`/signoff/<token>`) can be sent to any external site linked from that page.
- **Fix:** Add `Referrer-Policy: no-referrer` on sign-off pages, plus `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options` and a basic content security policy.

### 25. Archived users can still sign in
- **Where:** Archiving sets `profiles.archived_at` only, and the account stays active.
- **Checked:** Read in code.
- **What could go wrong:**
  - A former agent's session or password still works against the database.
  - Combined with finding 1, they can clear their own `archived_at`.
- **Fix:** Ban or delete the auth user when archiving, and revoke their sessions.

### 26. Internal helpers are exposed as server actions
- **Where:**
  - `src/lib/actions/website-scan.ts:695` (`runDailyListingScan`, which takes no arguments and uses the service role)
  - exported helpers in other `"use server"` files that take a database client as an argument
  - `updatePropertyDetails` (`properties.ts:442`) skips `requireAuthContext`
- **Checked:** Read in code.
- **What could go wrong:**
  - Every export in a `"use server"` file can be called by the browser.
  - Today, Next only exposes the ones a page uses. One import from a client component would let anyone run the full AI sweep across all agencies.
- **Fix:** Move cron jobs and helpers out of `"use server"` files, and make every action call `requireAuthContext()` first.

### 27. Two AI reads have no error handling
- **Where:** `src/lib/actions/extraction.ts:738` (CPD certificate) and `:1225` (inspection reports).
- **Checked:** Read in code.
- **What could go wrong:**
  - An Anthropic 429 or 500 makes the action throw.
  - The card spinner never stops (`ItemCard.tsx:1962`).
  - The CPD record is not saved (`registers.ts:144`).
- **Fix:** Catch the error, show "couldn't read it, please fill in by hand", and save the record anyway.

### 28. Most emails don't show RealComply Pty Ltd and the ABN, and some ask people to reply to a no-reply address
- **Where:**
  - The company and ABN appear only in `trial-ending.ts:206`, `subscription-end/emails.ts:29` and the certificate PDF.
  - They are missing from:
    - the sign-off request
    - the founder invite
    - the weekly digest
    - the licence and trust reminders
    - the price alert
    - the early-access acknowledgement
  - `founder-invite.ts:63-66` says "reply to this email … comes straight to me", but there is no `replyTo`.
- **Checked:** Read in code.
- **Fix:** Put "RealComply Pty Ltd · ABN 61 700 934 792" in the shared email layout so every email carries it. Set `replyTo` on emails that invite a reply, or confirm that `EMAIL_FROM` is a monitored mailbox.

### 29. A few lines claim more than the product can stand behind
- **Where:**
  - `src/lib/signoff/sign-stamp.ts:236`: the signature page says the record is "evidence of proper supervision under section 32".
  - `src/app/page.tsx:105`: "anything missing is flagged before the property goes to market".
  - `src/app/page.tsx:109`: "we'll let you know", backed by a job that can fail silently (finding 9).
- **Checked:** Read in code. A search for "compliant", "guarantee", "certified" and "100%" found only disclaimers or neutral uses.
- **Fix:**
  - Change "proper supervision" to "a record of supervision".
  - Change "flagged" to "flagged for you to check".
  - Change "we'll let you know" to "we'll flag it".

### 30. AI reads send ID and contract documents overseas, and this needs to be disclosed
- **Where:**
  - `src/lib/actions/extraction.ts:1137` (ID screen)
  - `:1329` (set-up documents with vendor and purchaser names and signatures)
  - `:864` (licences)
- **Checked:** Read in code.
- **What could go wrong:**
  - Under APP 8, sending personal information to an overseas recipient (Anthropic) has to be disclosed in the privacy policy.
  - Anthropic's retention terms need to be checked.
  - The ID screen sends the very documents the product says it does not keep.
- **Fix:** Add the cross-border disclosure and confirm Anthropic's data-retention or zero-retention terms in writing.

### 31. Deleting data 14 days after cancelling sits awkwardly with the 3-year record-keeping duty
- **Where:** `src/lib/subscription-end/` and the terms.
- **Checked:** Read in code.
- **What could go wrong:** An agency cancels, misses the 14-day download window, and loses records it must keep for 3 years under s104.
- **Fix:** Spell out clearly in the terms, the cancel screen and each notice email that the agency must download its records within the 14 days. Consider a longer window or a paid archive.

### 32. Backups have never been test-restored
- **Where:** The database relies on Supabase backups only. Files are copied to AWS by `backup-storage`, which reports nothing (finding 9).
- **Checked:** Read in code. There is no restore runbook in the repo.
- **What could go wrong:** On the day a restore is needed, nobody knows whether it works or how long it takes.
- **Fix:** Do one test restore into a separate project and write down the steps. Confirm the Supabase plan's point-in-time recovery window.

---

## Later

### 33. Nothing in the database stops a protected agency's row being deleted
- **Where:** `supabase/migrations/0054_subscription_end.sql`. The protection guards `ended_at`, but no BEFORE DELETE trigger checks `agency_is_protected`.
- **Checked:** Read in code.
- **What could go wrong:** A future code bug deletes Cass or Comply. Today two checks in code prevent this, but the database itself does not.
- **Fix:** Add a BEFORE DELETE trigger on `agencies` that refuses when `agency_is_protected(id)`.

### 34. Two deletion runs can start at once and email the certificate twice
- **Where:** `0054_subscription_end.sql:363-379` and `deletion.ts:277-282`.
- **Checked:** Read in code.
- **Fix:** Add a unique index on open runs per agency, and record "emailed" before sending.

### 35. A test run for one agency also runs the steps for all agencies
- **Where:** `src/app/api/cron/subscription-end/route.ts:38-40`.
- **Checked:** Read in code.
- **Fix:** When `?agency=` is given, skip the all-agency notices and the 7-year purge.

### 36. Errors in the 7-year purge are ignored
- **Where:** `src/lib/subscription-end/deletion.ts:572-582`.
- **Checked:** Read in code.
- **Fix:** Check the delete result and alert the admin if it fails.

### 37. The cron password is compared in a way that leaks timing
- **Where:** `src/app/api/cron/*/route.ts`, which use `!==`.
- **Checked:** Read in code.
- **Fix:** Use `timingSafeEqual`. This is low risk over the network.

### 38. Stored file paths are not checked against the agency
- **Where:**
  - `set_agency_logo` (`0030:34-58`)
  - `property_items.evidence_path`
  - the audit pack, which downloads files with full database rights (`audit-pack.ts:68, 151`)
- **Checked:** Read in code.
- **What could go wrong:** An ended agency's licensee could pull another agency's file into their audit pack. To do this they would need to know its full path, which is impractical.
- **Fix:** Check that paths start with the agency's own id, both when storing and when downloading.

### 39. The "account holder" who can download everything after an agency ends may be the wrong person
- **Where:** `src/lib/subscription-end/access.ts:27-35`.
- **Checked:** Read in code.
- **What could go wrong:** If the founder has been removed, the next-oldest agent becomes the account holder and can export the whole agency, including licensee-only registers.
- **Fix:** Limit this to the licensee in charge, or to a named billing contact.

### 40. The deletion certificate breaks on non-English names
- **Where:** `src/lib/subscription-end/certificate.ts:118-119`, which uses the standard Helvetica font.
- **Checked:** Read in code.
- **What could go wrong:** A subscriber name containing Chinese characters or an emoji makes the certificate fail. The deletion run then stays marked as failed.
- **Fix:** Pass names through the same `ascii()` clean-up the signature page uses, or embed a Unicode font.

### 41. No change history on compliance items
- **Where:** `property_items` has no audit table or trigger.
- **Checked:** Read in code.
- **What could go wrong:** Fair Trading asks who ticked an item and when it changed. Only the latest state exists.
- **Fix:** Add an append-only history table filled by a trigger.

### 42. The server-action size limit is 75 MB
- **Where:** `next.config.ts:28`.
- **Checked:** Read in code.
- **Fix:** Lower it to what the forms need. Vercel caps requests at about 4.5 MB anyway.

### 43. Signed-out sign-off and invite lookups have no rate limit
- **Where:** The public functions `get_signoff_request_v2`, `submit_signoff`, `invite_preview` and `founder_invite_valid`.
- **Checked:** Read in code. The tokens are random enough that guessing them is not realistic.
- **What could go wrong:** Someone floods these lookups to load the database or run up cost. They cannot break in this way.
- **Fix:** Add a per-IP limit, either at Vercel's firewall or in the proxy once finding 10 is fixed.

### 44. The example settings file is out of date
- **Where:** `.env.local.example`.
- **Checked:** Read in code. No real secrets are committed anywhere in the history.
- **What could go wrong:** The file is missing the Anthropic, Stripe, Resend, Google and backup settings. Its note about the service-role key is wrong.
- **Fix:** List every setting name with a one-line description, without values.

### 45. Several libraries are behind
- **Where:** `package.json`.
  - `@supabase/supabase-js`: 2.112 → 2.117
  - `@supabase/ssr`: 0.12.4 → 0.12.7
  - `@anthropic-ai/sdk`: 0.115 → 0.132
  - `react`: 19.2.8 → 19.3.0
  - The `sharp` and `eslint-config-next` chains have high-severity advisories, but only in build and tooling paths.
- **Checked:** `npm outdated` and `npm audit`.
- **Fix:** Update them in one PR after finding 8, with tests and a preview.

---

## Checked and found sound
- Every place that uses full database rights checks first that the caller is a platform admin or belongs to the right agency.
- All six crons require `CRON_SECRET` and refuse every request if it is missing.
- The Stripe webhook verifies its signature, with a constant-time compare and a 5-minute tolerance, before doing anything.
- A customer cannot point a payment at another agency, and Stripe cannot grant a free plan.
- Cass and Comply are protected from deletion in code, in the database function and in the `ended_at` trigger.
- Sign-off links:
  - They are random, expire after 30 days and work once.
  - They show the minimum needed.
  - There is no public table access.
- Unsubscribe links are signed (HMAC). Following the link changes nothing; only the confirm button does.
- `/api/search` requires sign-in.
- File downloads use the signed-in user's own rights and expire after 1 hour. Storage rules keep each agency to its own folder.
- No secrets are in the code or the git history. Only harmless settings are exposed to the browser.
- The AI reports what it sees and the code does the ESP maths. Discovery only accepts links from the agency's own site.
- Email subjects can't be used to inject headers.
- The marketing and product wording doesn't claim to guarantee compliance, and carries a clear disclaimer.
