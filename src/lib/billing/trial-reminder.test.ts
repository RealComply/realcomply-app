import { afterEach, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { StripeApiError } from "./stripe";
import { handleTrialWillEnd, type TrialReminderDeps, type TrialSubscription } from "./trial-reminder";
import type { TrialEndingInput } from "@/lib/email/trial-ending";

// 15 Oct 2026 09:00 UTC (8pm in Sydney), and "now" three days before it.
const TRIAL_END = Date.UTC(2026, 9, 15, 9) / 1000;
const NOW = (TRIAL_END - 3 * 86_400) * 1000;

function subscription(overrides: Partial<TrialSubscription> = {}): TrialSubscription {
  return {
    id: "sub_test",
    status: "trialing",
    customer: "cus_test",
    trial_end: TRIAL_END,
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { agency_id: "agency-1" },
    items: { data: [{ price: { lookup_key: "office_1_monthly" } }] },
    ...overrides,
  };
}

function deps(overrides: Partial<TrialReminderDeps> = {}) {
  const sent: TrialEndingInput[] = [];
  const previews: string[] = [];
  const d: TrialReminderDeps = {
    previewFirstInvoice: async (id) => {
      previews.push(id);
      return { amount_due: 24_900, currency: "aud" };
    },
    agencyIdForCustomer: async () => null,
    sendTrialEndingEmail: async (input) => {
      sent.push(input);
      return "sent";
    },
    now: () => NOW,
    ...overrides,
  };
  return { d, sent, previews };
}

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  mock.method(console, "log", (...args: unknown[]) => logs.push(args.join(" ")));
  mock.method(console, "error", (...args: unknown[]) => errors.push(args.join(" ")));
});

afterEach(() => mock.restoreAll());

describe("handleTrialWillEnd", () => {
  it("normal: sends the reminder with Stripe's amount and the trial end date", async () => {
    const { d, sent } = deps();

    const outcome = await handleTrialWillEnd(subscription(), d);

    assert.equal(outcome, "sent");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].amountCents, 24_900);
    assert.equal(sent[0].trialEnd.getTime(), TRIAL_END * 1000);
    assert.equal(sent[0].agencyId, "agency-1");
    assert.equal(sent[0].plan, "office_1");
    assert.equal(sent[0].interval, "monthly");
  });

  it("cancelling at trial end (cancel_at_period_end): no preview, no email, one log line", async () => {
    const { d, sent, previews } = deps();

    const outcome = await handleTrialWillEnd(subscription({ cancel_at_period_end: true }), d);

    assert.equal(outcome, "skipped_cancelling");
    assert.equal(previews.length, 0, "Stripe is not asked to preview an invoice that will never exist");
    assert.equal(sent.length, 0);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /sub_test.*cancel at trial end.*no reminder/);
    assert.equal(errors.length, 0);
  });

  it("cancelling at trial end (cancel_at on or before trial_end): skipped the same way", async () => {
    const { d, sent, previews } = deps();

    for (const cancelAt of [TRIAL_END, TRIAL_END - 86_400]) {
      const outcome = await handleTrialWillEnd(subscription({ cancel_at: cancelAt }), d);
      assert.equal(outcome, "skipped_cancelling");
    }
    assert.equal(previews.length, 0);
    assert.equal(sent.length, 0);
  });

  it("cancel_at after the trial: the first payment still happens, so the reminder still goes", async () => {
    const { d, sent } = deps();

    const outcome = await handleTrialWillEnd(subscription({ cancel_at: TRIAL_END + 30 * 86_400 }), d);

    assert.equal(outcome, "sent");
    assert.equal(sent.length, 1);
  });

  it("preview fails: sends the reminder without the amount, logs Stripe's code, does not throw", async () => {
    const { d, sent } = deps({
      previewFirstInvoice: async () => {
        throw new StripeApiError(
          "Stripe POST /invoices/create_preview: No upcoming invoices for customer",
          400,
          "invoice_upcoming_none",
        );
      },
    });

    const outcome = await handleTrialWillEnd(subscription(), d);

    assert.equal(outcome, "sent_without_amount");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].amountCents, null);
    assert.equal(sent[0].trialEnd.getTime(), TRIAL_END * 1000);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Stripe code invoice_upcoming_none/);
  });

  it("mail provider down: throws, so the route answers 500 and Stripe retries", async () => {
    const { d } = deps({ sendTrialEndingEmail: async () => "send_failed" });

    await assert.rejects(handleTrialWillEnd(subscription(), d), /not sent/);
  });
});
