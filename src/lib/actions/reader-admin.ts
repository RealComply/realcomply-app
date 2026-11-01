"use server";

import { requireProfile } from "@/lib/data/current-profile";
import { runReaderCheck, readerCheckSummary } from "@/lib/documents/reader-check";
import { renderEmailHtml, renderEmailText } from "@/lib/email/layout";
import { exampleReaderWeek, readerWeekEmail } from "@/lib/email/reader-week";
import { sendEmail } from "@/lib/email/send";
import { jobProblemEmail } from "@/lib/monitoring/check-in";
import { isTestAddress } from "@/lib/early-access/rules";

// The reader's checks on the staff page (Adam, 1 Nov 2026). RealComply staff
// only, and only ever to Adam's test addresses (getadamc3+…@gmail.com):
//
//   1. The daily reader check, run now with the real reader, its result
//      emailed: the email Adam gets when the check has a problem, or, when it
//      passed, a [Test] email saying so (on live a check that passes sends no
//      email; it only reports to Healthchecks).
//   2. Monday's staff email about the week's reads, with made-up figures.
//
// Nothing about any office: the check reads the made-up sample report, and the
// weekly email's test uses an example week.

export type ReaderAdminState = { error: string | null; notice?: string };

const notStaff = "Only RealComply staff can do that.";
const onlyTest = "Test emails only go to your test addresses (getadamc3+…@gmail.com).";

export async function runReaderCheckTest(_prev: ReaderAdminState, formData: FormData): Promise<ReaderAdminState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };
  const to = String(formData.get("email") ?? "").trim();
  if (!isTestAddress(to)) return { error: onlyTest };

  const result = await runReaderCheck();
  const email = result.ok
    ? {
        subject: "RealComply: the daily reader check passed",
        text:
          `${readerCheckSummary(result)}\n\n` +
          "On live, a check that passes sends no email: it reports success to Healthchecks (reader-check). " +
          "This email is only sent by the test on the staff page.",
      }
    : jobProblemEmail("reader-check", result.problems, new Date());
  const sent = await sendEmail({ to, subject: `[Test] ${email.subject}`, text: email.text });
  if (!sent) return { error: `${readerCheckSummary(result)} The email didn't send: the email provider refused it.` };
  return { error: null, notice: `${readerCheckSummary(result)} Emailed to ${to}.` };
}

export async function sendReaderWeekTest(_prev: ReaderAdminState, formData: FormData): Promise<ReaderAdminState> {
  const profile = await requireProfile();
  if (profile.is_platform_admin !== true) return { error: notStaff };
  const to = String(formData.get("email") ?? "").trim();
  if (!isTestAddress(to)) return { error: onlyTest };

  const { subject, doc } = readerWeekEmail(exampleReaderWeek(new Date()), { test: true });
  const sent = await sendEmail({ to, subject, text: renderEmailText(doc), html: renderEmailHtml(doc) });
  if (!sent) return { error: "The test didn't send. The email provider refused it; check the email settings." };
  return { error: null, notice: `Sent the weekly staff email, with made-up figures, to ${to}.` };
}
