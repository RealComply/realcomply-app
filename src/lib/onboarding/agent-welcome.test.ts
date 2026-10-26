import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SendEmailInput } from "@/lib/email/send";
import {
  ANNEXURE_DOWNLOAD_LINE,
  ANNEXURE_DOWNLOAD_LINK,
  OFFICE_SG_ADOPTED,
  OFFICE_SG_HEADING,
  OFFICE_SG_READ,
  buildAgentWelcomeEmail,
  buildWelcomeEmail,
} from "@/lib/email/early-access-invite";
import { sendTestAgentWelcome, welcomeOfficeAgent } from "./agent-welcome";
import { videosFor } from "./videos";
import { HOME, nextPage } from "@/lib/auth/next-page";
import { isOfficeAgent, sgReadDue } from "@/lib/sg-annexure/office-read";

// The agent welcome email and the Supervision Guidelines read-and-tick
// (brief, 14 Oct 2026; email mockup approved by Adam).

const BASE = "https://www.realcomply.com.au";
const ON = { EARLY_ACCESS_WELCOME_EMAIL: "on", NEXT_PUBLIC_SITE_URL: BASE };

const officeBox = (adopted: boolean) =>
  ({
    kind: "office_sg",
    annexureUrl: adopted ? `${BASE}/dashboard/annexure` : null,
    sgUrl: `${BASE}/dashboard/sg-manual`,
  }) as const;

describe("the agent welcome email", () => {
  const email = buildAgentWelcomeEmail({ firstName: "sam", base: BASE, box: null });

  it("has the brief's wording, word for word", () => {
    assert.equal(email.subject, "Welcome to RealComply, Sam");
    assert.ok(email.text.includes("Hi Sam,"));
    assert.ok(
      email.text.includes(
        "Welcome aboard. Your account is all set up, and we're really glad to have you with us. We look forward to helping you keep on top of your compliance obligations.",
      ),
    );
    assert.ok(
      email.text.includes(
        "To help you find your feet, we've made a short video that walks through RealComply from an agent's side, on a made-up listing. It takes less than two minutes.",
      ),
    );
  });

  it("the video picture: For agents, 1 min 46, the agent still, alt text, linking to Getting started", () => {
    assert.ok(email.html.includes(`src="${BASE}/email-agent-video.png"`));
    assert.ok(email.html.includes('alt="Still from the agent video showing the red and amber dots on Listings"'));
    assert.ok(email.html.includes(`href="${BASE}/dashboard/getting-started"`));
    assert.ok(email.html.includes(">For agents<") && email.html.includes(">1 min 46<"));
    assert.ok(email.text.includes(`Watch the video (For agents, 1 min 46): ${BASE}/dashboard/getting-started`));
    assert.ok(!email.html.includes("youtu"), "never straight to YouTube");
  });

  it("everything else is the licensee welcome's: the first listing, the group, the help line, the sign-off, the footer", () => {
    const licensee = buildWelcomeEmail({ firstName: "sam", base: BASE });
    const tail = (t: string) => t.slice(t.indexOf("When you're ready"));
    assert.equal(tail(email.text), tail(licensee.text));
    assert.ok(!email.text.includes("Your office is all set up"));
    assert.ok(!email.text.includes("For licensees"));
  });

  it("no em dashes anywhere a reader sees", () => {
    for (const box of [null, { kind: "download", url: `${BASE}/annexure/download` } as const, officeBox(true), officeBox(false)]) {
      const e = buildAgentWelcomeEmail({ firstName: "sam", base: BASE, box });
      assert.ok(!e.text.includes("—") && !e.html.includes("—"));
    }
  });
});

describe("the Supervision Guidelines box under the video", () => {
  it("an agent on their own plan: the #42 download box, exactly", () => {
    const e = buildAgentWelcomeEmail({ firstName: null, base: BASE, box: { kind: "download", url: `${BASE}/annexure/download` } });
    assert.ok(e.text.includes(`${ANNEXURE_DOWNLOAD_LINK} (PDF): ${BASE}/annexure/download`));
    assert.ok(e.text.includes(ANNEXURE_DOWNLOAD_LINE));
    assert.ok(!e.text.includes(OFFICE_SG_HEADING));
  });

  it("an agent invited by an office that has adopted: heading, both sentences, both links", () => {
    const e = buildAgentWelcomeEmail({ firstName: null, base: BASE, box: officeBox(true) });
    assert.equal(OFFICE_SG_HEADING, "Your office's Supervision Guidelines");
    assert.equal(
      `${OFFICE_SG_ADOPTED} ${OFFICE_SG_READ}`,
      "Your licensee in charge has adopted RealComply's annexure to your agency's Supervision Guidelines. Please read both, then confirm in RealComply that you have.",
    );
    assert.ok(e.html.includes(OFFICE_SG_HEADING.replace("'", "&#39;")) || e.html.includes(OFFICE_SG_HEADING));
    assert.ok(e.text.includes(`${OFFICE_SG_ADOPTED} ${OFFICE_SG_READ}`));
    assert.ok(e.text.includes(`Read the annexure: ${BASE}/dashboard/annexure`));
    assert.ok(e.text.includes(`Read your Supervision Guidelines: ${BASE}/dashboard/sg-manual`));
    assert.ok(e.html.includes(`href="${BASE}/dashboard/annexure"`) && e.html.includes(`href="${BASE}/dashboard/sg-manual"`));
    // The annexure link comes first.
    assert.ok(e.text.indexOf("Read the annexure:") < e.text.indexOf("Read your Supervision Guidelines:"));
    assert.ok(!e.text.includes(ANNEXURE_DOWNLOAD_LINK));
  });

  it("not adopted yet: no annexure link and no first sentence, just \"Please read them.\" and the Supervision Guidelines link", () => {
    const e = buildAgentWelcomeEmail({ firstName: null, base: BASE, box: officeBox(false) });
    assert.ok(e.text.includes(OFFICE_SG_HEADING));
    assert.ok(!e.text.includes(OFFICE_SG_ADOPTED));
    // Adam, 14 Oct 2026: one link, and nothing to confirm until the licensee adopts.
    assert.ok(e.text.includes(`${OFFICE_SG_HEADING}\nPlease read them.\n`));
    assert.ok(e.html.includes(">Please read them.</p>"));
    assert.ok(!e.text.includes(OFFICE_SG_READ) && !e.text.includes("confirm"));
    assert.ok(!e.text.includes("Read the annexure"));
    assert.ok(!e.html.includes("/dashboard/annexure"));
    assert.ok(e.text.includes(`Read your Supervision Guidelines: ${BASE}/dashboard/sg-manual`));
  });
});

/** The new agent's own Supabase client, as welcomeOfficeAgent uses it. */
function agentClient(opts: { claims?: boolean; adopted?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string) => {
      calls.push(fn);
      if (fn === "claim_office_agent_welcome") return { data: opts.claims ?? true, error: null };
      if (fn === "office_annexure_adoption") {
        return {
          data: opts.adopted ? [{ annexure_version: "1.4", adopted_by_name: "Lee Licensee", adopted_at: "2026-10-14T01:00:00Z" }] : [],
          error: null,
        };
      }
      return { data: null, error: null };
    },
    auth: { getUser: async () => ({ data: { user: { id: "a1", email: "getadamc3+agent@gmail.com" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { email: "getadamc3+agent@gmail.com", full_name: "alex Agent" }, error: null }) }),
      }),
    }),
  };
}

function recorder(ok = true) {
  const sent: SendEmailInput[] = [];
  return { sent, send: async (i: SendEmailInput) => (sent.push(i), ok) };
}

describe("an agent invited by their office", () => {
  it("gets the agent welcome once their invite is accepted, with both links when the office has adopted", async () => {
    const db = agentClient({ adopted: true });
    const r = recorder();
    assert.equal(await welcomeOfficeAgent(db, { send: r.send, env: ON }), "sent");
    assert.equal(r.sent.length, 1);
    const [m] = r.sent;
    assert.equal(m.to, "getadamc3+agent@gmail.com");
    assert.equal(m.subject, "Welcome to RealComply, Alex");
    assert.equal(m.bcc, "admin@realcomply.com.au");
    assert.equal(m.replyTo, "admin@realcomply.com.au");
    assert.equal(m.fromName, "RealComply");
    assert.ok(m.text.includes(`Read the annexure: ${BASE}/dashboard/annexure`));
    assert.ok(m.text.includes(`Read your Supervision Guidelines: ${BASE}/dashboard/sg-manual`));
  });

  it("before the office has adopted: the Supervision Guidelines link only", async () => {
    const r = recorder();
    await welcomeOfficeAgent(agentClient({ adopted: false }), { send: r.send, env: ON });
    assert.ok(!r.sent[0].text.includes("Read the annexure"));
    assert.ok(r.sent[0].text.includes("Read your Supervision Guidelines"));
  });

  it("nothing when the database says no: already welcomed, the licensee, an assistant, or an agent plan", async () => {
    const db = agentClient({ claims: false });
    const r = recorder();
    assert.equal(await welcomeOfficeAgent(db, { send: r.send, env: ON }), "not_claimed");
    assert.equal(r.sent.length, 0);
  });

  it("a send that fails gives the claim back", async () => {
    const db = agentClient({ adopted: true });
    assert.equal(await welcomeOfficeAgent(db, { send: recorder(false).send, env: ON }), "failed");
    assert.ok(db.calls.includes("release_office_agent_welcome"));
  });

  it("switched off with the licensee welcome: nothing, and nothing claimed", async () => {
    const db = agentClient();
    const r = recorder();
    assert.equal(await welcomeOfficeAgent(db, { send: r.send, env: { NEXT_PUBLIC_SITE_URL: BASE } }), "switched_off");
    assert.deepEqual(db.calls, []);
    assert.equal(r.sent.length, 0);
  });

  it("is sent from each of the three places an invite is accepted", () => {
    const at = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
    assert.ok(/inviteToken[\s\S]{0,80}welcomeOfficeAgent\(supabase\)/.test(at("lib/actions/auth.ts")));
    assert.ok(/if \(!joinError\) await welcomeOfficeAgent\(supabase\)/.test(at("lib/auth/complete-signup.ts")));
    assert.ok(/if \(meta\.invite_token\) await welcomeOfficeAgent\(supabase\)/.test(at("lib/data/current-profile.ts")));
  });
});

describe("the staff page's test copy", () => {
  const picture = async () => new Uint8Array([137, 80, 78, 71]);

  it("only to the test addresses", async () => {
    const r = recorder();
    const out = await sendTestAgentWelcome({ to: "someone@example.com", firstName: "Adam", kind: "own_plan" }, { send: r.send, env: ON, picture });
    assert.ok(out.error);
    assert.equal(r.sent.length, 0);
  });

  it("each version, marked [Test], with the picture inside the email until it is live", async () => {
    for (const kind of ["own_plan", "office_adopted", "office_not_adopted"] as const) {
      const r = recorder();
      const out = await sendTestAgentWelcome({ to: "getadamc3+agent@gmail.com", firstName: "Adam", kind }, { send: r.send, env: ON, picture });
      assert.equal(out.error, null);
      const [m] = r.sent;
      assert.equal(m.subject, "[Test] Welcome to RealComply, Adam");
      assert.equal(m.bcc, undefined, "no copy to admin@ for a test");
      assert.ok(m.html?.includes('src="cid:agent-video"'));
      assert.equal(m.attachments?.[0]?.cid, "agent-video");
      assert.equal(m.text.includes(ANNEXURE_DOWNLOAD_LINK), kind === "own_plan");
      assert.equal(m.text.includes("Read the annexure:"), kind === "office_adopted");
      assert.equal(m.text.includes("Read your Supervision Guidelines:"), kind !== "own_plan");
    }
  });
});

describe("Getting started", () => {
  it("agents see the agent video; licensees see both", () => {
    assert.deepEqual(videosFor({ officeLicensee: false }).map((v) => v.id), ["l8KbqTAegLc"]);
    assert.deepEqual(videosFor({ officeLicensee: true }).map((v) => v.id), ["xzAW28t758g", "l8KbqTAegLc"]);
    const agent = videosFor({ officeLicensee: false })[0];
    assert.equal(agent.title, "RealComply for agents");
    assert.equal(agent.length, "1 min 46");
  });
});

describe("the read-and-tick on Home", () => {
  const officeAgent = { actsAsLicensee: false, isAssistant: false, worksAsAgentPlan: false };
  const adoption = { version: "1.4", adoptedByName: "Lee Licensee", adoptedAt: "2026-10-14T01:00:00Z" };

  it("is for agents in an office only: not the licensee, an assistant, or an agent on their own plan", () => {
    assert.equal(isOfficeAgent(officeAgent), true);
    assert.equal(isOfficeAgent({ ...officeAgent, actsAsLicensee: true }), false);
    assert.equal(isOfficeAgent({ ...officeAgent, isAssistant: true }), false);
    assert.equal(isOfficeAgent({ actsAsLicensee: true, isAssistant: false, worksAsAgentPlan: true }), false);
  });

  it("shows once the office has adopted, until the agent confirms that version", () => {
    assert.equal(sgReadDue({ officeAgent: true, adoption: null, confirmedVersions: [] }), false);
    assert.equal(sgReadDue({ officeAgent: true, adoption, confirmedVersions: [] }), true);
    assert.equal(sgReadDue({ officeAgent: true, adoption, confirmedVersions: ["1.4"] }), false);
    assert.equal(sgReadDue({ officeAgent: true, adoption, confirmedVersions: ["1.3"] }), true, "a new version asks again");
    assert.equal(sgReadDue({ officeAgent: false, adoption, confirmedVersions: [] }), false);
  });
});

describe("back to the page an email linked to, after signing in", () => {
  it("a dashboard page comes back; anything else goes Home", () => {
    assert.equal(nextPage("/dashboard/annexure"), "/dashboard/annexure");
    assert.equal(nextPage("/dashboard/sg-manual"), "/dashboard/sg-manual");
    assert.equal(nextPage("/dashboard/getting-started?x=1"), "/dashboard/getting-started?x=1");
    for (const bad of [null, "", "https://evil.example/dashboard", "//evil.example", "/dashboardx", "/dashboard\\..\\x", "/login"]) {
      assert.equal(nextPage(bad), HOME, String(bad));
    }
  });
});

describe("nothing points at the old agent videos", () => {
  it("GQflzVRgGqY and C_iODNXonlw appear nowhere in the app", () => {
    const files = ["lib/onboarding/videos.ts", "app/dashboard/getting-started/page.tsx", "lib/email/early-access-invite.ts"];
    for (const f of files) {
      const text = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
      assert.ok(!text.includes("GQflzVRgGqY") && !text.includes("C_iODNXonlw"), f);
    }
  });
});

describe("the agent's tick is kept with the office's records", () => {
  it("is in Download all records, with the person named", () => {
    const records = readFileSync(new URL("../subscription-end/records.ts", import.meta.url), "utf8");
    assert.ok(/table: "sg_read_confirmations", file: "SG annexure and Supervision Guidelines read"/.test(records));
    assert.ok(/PERSON_COLUMNS[\s\S]{0,400}"confirmed_by"/.test(records));
  });

  it("is in the 7-year activity record (0069)", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/0069_agent_welcome_sg_read.sql", import.meta.url), "utf8");
    assert.ok(sql.includes("'sg_read_confirmations', coalesce("));
  });

  it("signed out, an email's link comes back to its page after sign-in", () => {
    const mw = readFileSync(new URL("../supabase/middleware.ts", import.meta.url), "utf8");
    assert.ok(mw.includes('url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`)'));
    const login = readFileSync(new URL("../actions/auth.ts", import.meta.url), "utf8");
    assert.ok(login.includes('redirect(nextPage(String(formData.get("next") ?? "")))'));
  });
});
