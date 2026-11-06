import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bandLine,
  confirmButtonLabel,
  daysLeft,
  decideChange,
  doneLine,
  isAgentToOffice,
  isOfficeToAgent,
  ladderRows,
  money,
  paySummaryRows,
  planDirection,
  priceCents,
  unavailableReason,
  wholeDollars,
} from "./plan-change";

describe("which way a plan change goes", () => {
  it("dearer on the same ladder is up, cheaper is down", () => {
    assert.equal(planDirection("agent_1", "agent_2"), "up");
    assert.equal(planDirection("office_3", "office_2"), "down");
    assert.equal(planDirection("office_1", "office_1"), "same");
  });

  it("agent to office is up, even at the same price; office to agent is down", () => {
    assert.equal(planDirection("agent_3", "office_1"), "up");
    assert.equal(planDirection("office_1", "agent_3"), "down");
    assert.equal(isAgentToOffice("agent_1", "office_1"), true);
    assert.equal(isOfficeToAgent("office_2", "agent_1"), true);
    assert.equal(isAgentToOffice("office_1", "office_2"), false);
  });
});

describe("when a change takes effect (mockup notes 2, 3 and 6)", () => {
  const monthly = (plan: Parameters<typeof planDirection>[0]) => ({ plan, interval: "monthly" as const });
  const annual = (plan: Parameters<typeof planDirection>[0]) => ({ plan, interval: "annual" as const });

  it("an upgrade is now, with the difference charged", () => {
    assert.deepEqual(decideChange({ from: monthly("agent_1"), to: monthly("office_1"), trialing: false }), {
      kind: "change",
      timing: "now",
      now: monthly("office_1"),
      prorate: true,
      next: null,
      direction: "up",
    });
  });

  it("a downgrade is from the next billing date, with nothing charged now", () => {
    assert.deepEqual(decideChange({ from: monthly("office_3"), to: monthly("office_2"), trialing: false }), {
      kind: "change",
      timing: "next_billing_date",
      now: null,
      prorate: false,
      next: monthly("office_2"),
      direction: "down",
    });
  });

  it("monthly to yearly, or back, is from the next billing date", () => {
    const toYearly = decideChange({ from: monthly("office_1"), to: annual("office_1"), trialing: false });
    assert.equal(toYearly.kind === "change" && toYearly.timing, "next_billing_date");
    const toMonthly = decideChange({ from: annual("office_1"), to: monthly("office_1"), trialing: false });
    assert.equal(toMonthly.kind === "change" && toMonthly.timing, "next_billing_date");
  });

  it("an upgrade with a switch to yearly: the plan now, yearly from the next billing date", () => {
    assert.deepEqual(decideChange({ from: monthly("agent_1"), to: annual("office_1"), trialing: false }), {
      kind: "change",
      timing: "now_then_next",
      now: monthly("office_1"),
      prorate: true,
      next: annual("office_1"),
      direction: "up",
    });
  });

  it("a downgrade with a switch to yearly waits for the next billing date, all of it", () => {
    const d = decideChange({ from: monthly("office_2"), to: annual("office_1"), trialing: false });
    assert.equal(d.kind === "change" && d.timing, "next_billing_date");
    assert.deepEqual(d.kind === "change" && d.next, annual("office_1"));
  });

  it("during the free trial any change is now, and nothing is charged", () => {
    const d = decideChange({ from: monthly("office_2"), to: annual("agent_1"), trialing: true });
    assert.deepEqual(d, {
      kind: "change",
      timing: "now",
      now: annual("agent_1"),
      prorate: false,
      next: null,
      direction: "down",
    });
  });

  it("the same plan and interval is no change", () => {
    assert.deepEqual(decideChange({ from: monthly("agent_2"), to: monthly("agent_2"), trialing: false }), {
      kind: "none",
    });
  });
});

describe("the ladder on Change plan", () => {
  const base = {
    current: { plan: "agent_1" as const, interval: "monthly" as const },
    interval: "monthly" as const,
    listingCount: 19,
    activePeople: 1,
  };

  it("shows both ladders with the mockup's prices and bands, the current plan marked", () => {
    const rows = ladderRows(base);
    assert.deepEqual(
      rows.agent.map((r) => [r.name, wholeDollars(r.price), r.band, r.current]),
      [
        ["Agent 1", "$99", "Up to 25 listings a year", true],
        ["Agent 2", "$169", "26 to 60 listings a year", false],
        ["Agent 3", "$249", "61 or more listings a year", false],
      ],
    );
    assert.deepEqual(
      rows.office.map((r) => [r.name, wholeDollars(r.price), r.band]),
      [
        ["Office 1", "$249", "Up to 50 listings a year"],
        ["Office 2", "$349", "51 to 150 listings a year"],
        ["Office 3", "$549", "151 to 250 listings a year"],
        ["Office 4", "$749", "251 to 400 listings a year"],
        ["Office 5", "$1,049", "401 or more listings a year"],
      ],
    );
    assert.equal(rows.agent[0].available, false);
    assert.equal(
      rows.office.every((r) => r.available),
      true,
    );
  });

  it("yearly prices are two months free, and the current plan isn't marked on the other interval", () => {
    const rows = ladderRows({ ...base, interval: "annual" });
    assert.equal(rows.agent[0].price, 990);
    assert.equal(rows.agent[0].current, false);
    assert.equal(rows.agent[0].available, true);
    assert.equal(bandLine("office_5"), "401 or more listings a year");
  });

  it("greys out a plan below the listings used in the last 12 months, with the reason", () => {
    const rows = ladderRows({ ...base, current: { plan: "office_3", interval: "monthly" }, listingCount: 162 });
    const office2 = rows.office.find((r) => r.plan === "office_2")!;
    assert.equal(office2.available, false);
    assert.equal(office2.reason, "Not available: you've listed 162 properties in the last 12 months.");
    assert.equal(rows.office.find((r) => r.plan === "office_4")!.available, true);
  });

  it("offers an agent plan to an office only when it has one person (mockup note 5)", () => {
    const team = ladderRows({ ...base, current: { plan: "office_1", interval: "monthly" }, activePeople: 3 });
    assert.equal(team.agent[0].available, false);
    assert.equal(team.agent[0].reason, "Not available: an agent plan is for one person, and your office has 3 people.");
    const solo = ladderRows({ ...base, current: { plan: "office_1", interval: "monthly" }, activePeople: 1 });
    assert.equal(solo.agent[0].available, true);
  });

  it("has the starting plan hook, off unless a floor is given", () => {
    const rows = ladderRows({
      ...base,
      current: { plan: "office_3", interval: "monthly" },
      listingCount: 10,
      floor: { plan: "office_2", until: "2027-03-14T00:00:00Z" },
    });
    assert.equal(rows.office[0].reason, "Not available until 14 March 2027: your starting plan holds for 12 months.");
    assert.equal(rows.office[1].available, true);
  });

  it("the server asks the same question before charging", () => {
    assert.equal(unavailableReason(base, "agent_1"), "That's your plan already.");
    assert.equal(unavailableReason(base, "office_1"), null);
    const office2 = { ...base, current: { plan: "office_2" as const, interval: "monthly" as const }, listingCount: 60 };
    assert.match(unavailableReason(office2, "office_1") ?? "", /listed 60 properties/);
  });
});

describe("the words", () => {
  it("money is always two decimals; ladder prices are whole dollars", () => {
    assert.equal(money(5918), "$59.18");
    assert.equal(money(24900), "$249.00");
    assert.equal(money(104900), "$1,049.00");
    assert.equal(wholeDollars(1049), "$1,049");
    assert.equal(priceCents("office_1", "annual"), 249000);
  });

  it("days left round up, never below one", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    assert.equal(daysLeft("2026-11-18T09:00:00Z", now), 12);
    assert.equal(daysLeft("2026-11-06T09:00:00Z", now), 1);
  });

  it("the button says what happens (mockup: Pay $59.18 and move to Office 1)", () => {
    assert.equal(
      confirmButtonLabel({ timing: "now", todayCents: 5918, planName: "Office 1", effectiveDate: "18 November 2026" }),
      "Pay $59.18 and move to Office 1",
    );
    assert.equal(
      confirmButtonLabel({ timing: "now", todayCents: 0, planName: "Office 1", effectiveDate: "18 November 2026" }),
      "Move to Office 1",
    );
    assert.equal(
      confirmButtonLabel({
        timing: "next_billing_date",
        todayCents: 0,
        planName: "Agent 1",
        effectiveDate: "18 November 2026",
      }),
      "Move to Agent 1 on 18 November 2026",
    );
  });

  it("the done line (mockup step 4)", () => {
    assert.deepEqual(
      doneLine({
        timing: "now",
        fromName: "Agent 1",
        toName: "Office 1",
        toOffice: true,
        fromAgent: true,
        effectiveDate: "6 November 2026",
        ongoingCents: 24900,
        interval: "monthly",
        nextPaymentDate: "18 November 2026",
      }),
      {
        title: "You're on Office 1.",
        body: "Your team, registers and office profile are ready. Next payment $249.00 on 18 November 2026.",
      },
    );
    assert.deepEqual(
      doneLine({
        timing: "next_billing_date",
        fromName: "Office 3",
        toName: "Office 2",
        toOffice: true,
        fromAgent: false,
        effectiveDate: "18 November 2026",
        ongoingCents: 34900,
        interval: "monthly",
        nextPaymentDate: "18 November 2026",
      }),
      {
        title: "Your plan changes to Office 2 on 18 November 2026.",
        body: "You stay on Office 3 until then. From that date it's $349.00 a month.",
      },
    );
    assert.equal(
      doneLine({
        timing: "now_then_next",
        fromName: "Agent 1",
        toName: "Office 1",
        toOffice: true,
        fromAgent: true,
        effectiveDate: "18 November 2026",
        ongoingCents: 249000,
        interval: "annual",
        nextPaymentDate: "18 November 2026",
      }).body,
      "Your team, registers and office profile are ready. From 18 November 2026 it's $2,490.00 a year.",
    );
  });
});

describe("What you'll pay (mockup step 3)", () => {
  const change = (
    from: Parameters<typeof decideChange>[0]["from"],
    to: Parameters<typeof decideChange>[0]["to"],
    trialing = false,
  ) => {
    const d = decideChange({ from, to, trialing });
    if (d.kind !== "change") throw new Error("no change");
    return d;
  };

  it("an upgrade now: the mockup's three lines", () => {
    const from = { plan: "agent_1" as const, interval: "monthly" as const };
    const to = { plan: "office_1" as const, interval: "monthly" as const };
    assert.deepEqual(
      paySummaryRows({
        decision: change(from, to),
        to,
        current: from,
        todayCents: 5918,
        periodEnd: "18 November 2026",
        trialEnd: null,
        daysLeft: 12,
      }),
      [
        { label: "Office 1, monthly", value: "$249.00" },
        { label: "Today: the difference for the 12 days left this month", value: "$59.18" },
        { label: "From 18 November 2026, each month", value: "$249.00", total: true },
      ],
    );
  });

  it("an upgrade with a switch to yearly: monthly now, yearly from the next billing date", () => {
    const from = { plan: "agent_1" as const, interval: "monthly" as const };
    const to = { plan: "office_1" as const, interval: "annual" as const };
    const rows = paySummaryRows({
      decision: change(from, to),
      to,
      current: from,
      todayCents: 5918,
      periodEnd: "18 November 2026",
      trialEnd: null,
      daysLeft: 1,
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      [
        "Office 1, monthly",
        "Today: the difference for the 1 day left this month",
        "From 18 November 2026, yearly, each year",
      ],
    );
    assert.equal(rows[2].value, "$2,490.00");
  });

  it("a downgrade: nothing today, the new price from the next billing date", () => {
    const from = { plan: "office_3" as const, interval: "monthly" as const };
    const to = { plan: "office_2" as const, interval: "monthly" as const };
    assert.deepEqual(
      paySummaryRows({
        decision: change(from, to),
        to,
        current: from,
        todayCents: 0,
        periodEnd: "18 November 2026",
        trialEnd: null,
        daysLeft: 12,
      }),
      [
        { label: "Office 2, monthly", value: "$349.00" },
        { label: "Today", value: "$0.00" },
        { label: "From 18 November 2026, each month", value: "$349.00", total: true },
      ],
    );
  });

  it("during the free trial: nothing today, the new price when the trial ends", () => {
    const from = { plan: "office_1" as const, interval: "monthly" as const };
    const to = { plan: "office_2" as const, interval: "monthly" as const };
    const rows = paySummaryRows({
      decision: change(from, to, true),
      to,
      current: from,
      todayCents: 0,
      periodEnd: "18 November 2026",
      trialEnd: "20 November 2026",
      daysLeft: 12,
    });
    assert.equal(rows[1].label, "Today, during your free trial");
    assert.equal(rows[2].label, "From 20 November 2026, when your free trial ends, each month");
  });
});
