import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import {
  ADMIN_COPY_ADDRESS,
  SENDER_NAME,
  buildAgentWelcomeEmail,
  type AgentWelcomeInput,
} from "@/lib/email/early-access-invite";
import { isTestAddress, welcomeSwitchedOn } from "@/lib/early-access/rules";
import type { WelcomeOutcome } from "@/lib/early-access/welcome";
import { firstNameOf } from "@/lib/legal/sg-annexure";
import { appBaseUrl } from "@/lib/site-url";

// The agent welcome email (brief, 14 Oct 2026; mockup approved by Adam). Who
// gets it, once, when their account set-up is complete:
//
//   1. Early access single agents (their own plan).
//   2. Single agents invited personally (their own plan).
//      Both hang off the same event as the licensee welcome: the Stripe
//      webhook, once the card is in and the trial has started
//      (lib/sg-annexure/new-office.ts). An agent on their own plan gets this
//      INSTEAD of the licensee welcome, and is never treated as the licensee:
//      the box under the video is the #42 download, unchanged.
//   3. Agents invited by their office. Hangs off accepting the invite: right
//      after accept_invite succeeds, on whichever of the three sign-up paths
//      ran it (lib/actions/auth.ts, lib/auth/complete-signup.ts,
//      lib/data/current-profile.ts), with the new agent's own session. The box
//      under the video is the office's Supervision Guidelines and, once the
//      licensee has adopted it, the annexure.
//
// ONCE. Each welcome is claimed by inserting a row in agent_welcome_emails
// (0069) before the email goes; a second attempt finds it taken. A send that
// fails gives the claim back. The row records when it was sent.
//
// SWITCHED OFF with the licensee welcome: EARLY_ACCESS_WELCOME_EMAIL=on in
// Vercel turns both on. The same sending rules: from EMAIL_FROM as
// "RealComply", reply-to and a blind copy to admin@realcomply.com.au, HTML and
// plain text.
//
// NEVER THROWS. A welcome that fails is logged; it must not fail a webhook
// (Stripe would retry) or a sign-up that has otherwise succeeded.

/** The few Supabase calls this uses, so a test can stand in for the client. */
type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args?: Record<string, unknown>) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  auth?: { getUser: () => Promise<{ data: { user: { id: string; email?: string | null } | null } }> };
};

type Deps = {
  send?: (input: SendEmailInput) => Promise<boolean>;
  env?: Record<string, string | undefined>;
  now?: Date;
};

/** The read-only annexure page for agents in an office (app/dashboard/annexure). */
export function readAnnexureUrl(base = appBaseUrl()): string {
  return `${base}/dashboard/annexure`;
}

/** The office's Supervision Guidelines (app/dashboard/sg-manual). */
export function supervisionGuidelinesUrl(base = appBaseUrl()): string {
  return `${base}/dashboard/sg-manual`;
}

function sendWelcome(send: (input: SendEmailInput) => Promise<boolean>, to: string, input: AgentWelcomeInput): Promise<boolean> {
  const { subject, text, html } = buildAgentWelcomeEmail(input);
  return send({ to, bcc: ADMIN_COPY_ADDRESS, replyTo: ADMIN_COPY_ADDRESS, fromName: SENDER_NAME, subject, text, html });
}

/**
 * Groups 1 and 2: an agent on their own plan, once their trial has started.
 * Server only, with the service key: the webhook has no signed-in person.
 */
export async function sendOwnPlanAgentWelcome(
  supabase: Client,
  agencyId: string,
  deps: Deps & { box: Extract<AgentWelcomeInput["box"], { kind: "download" }> },
): Promise<WelcomeOutcome> {
  const send = deps.send ?? sendEmail;
  const env = deps.env ?? process.env;
  const now = (deps.now ?? new Date()).toISOString();
  if (!welcomeSwitchedOn(env)) return "switched_off";

  try {
    // The invitation the agent signed up with: early access or personal.
    const { data: invites } = await supabase
      .from("founder_invites")
      .select("token, accepted_by, email, first_name")
      .eq("agency_id", agencyId)
      .not("accepted_at", "is", null);
    const invite = ((invites ?? []) as Array<{
      token: string;
      accepted_by: string | null;
      email: string | null;
      first_name: string | null;
    }>).find((i) => i.accepted_by);
    if (!invite?.accepted_by) return "not_early_access";

    const { data: earlyRow } = await supabase
      .from("early_access")
      .select("id, first_name, welcome_sent_at, unsubscribed_at")
      .eq("invited_token", invite.token)
      .maybeSingle();
    const early = earlyRow as {
      id: string;
      first_name: string | null;
      welcome_sent_at: string | null;
      unsubscribed_at: string | null;
    } | null;
    // Neither early access nor a personal invitation (an older founder link).
    if (!early && !invite.email) return "not_early_access";
    if (early?.unsubscribed_at) return "unsubscribed";
    if (early?.welcome_sent_at) return "already_sent";

    const { error: claimError } = await supabase
      .from("agent_welcome_emails")
      .insert({ profile_id: invite.accepted_by, agency_id: agencyId, kind: "own_plan", sent_at: now });
    if (claimError) {
      if (claimError.code === "23505") return "already_sent";
      console.error("agent welcome: claim failed", agencyId, claimError.message);
      return "failed";
    }
    // The staff page shows an early access welcome as sent from its own row.
    if (early) {
      await supabase.from("early_access").update({ welcome_sent_at: now }).eq("id", early.id).is("welcome_sent_at", null);
    }
    const undo = async () => {
      await supabase.from("agent_welcome_emails").delete().eq("profile_id", invite.accepted_by).eq("sent_at", now);
      if (early) await supabase.from("early_access").update({ welcome_sent_at: null }).eq("id", early.id).eq("welcome_sent_at", now);
    };

    const { data: person } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", invite.accepted_by)
      .maybeSingle();
    const p = person as { email: string | null; full_name: string | null } | null;
    const to = p?.email?.trim();
    if (!to) {
      await undo();
      console.error("agent welcome: no address for", agencyId);
      return "failed";
    }

    const sent = await sendWelcome(send, to, {
      firstName: early?.first_name ?? invite.first_name ?? firstNameOf(p?.full_name ?? null),
      base: appBaseUrl(env),
      box: deps.box,
    });
    if (!sent) {
      await undo();
      console.error("agent welcome: send failed", { agencyId });
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("agent welcome (own plan) failed:", agencyId, err);
    return "failed";
  }
}

export type OfficeWelcomeOutcome = "sent" | "switched_off" | "not_claimed" | "failed";

/**
 * Group 3: an agent who has just accepted their office's invite. Called with
 * the new agent's own session; the database decides whether they qualify
 * (an agent, not the licensee, not an assistant, an office plan) and whether
 * the welcome has already gone.
 */
export async function welcomeOfficeAgent(supabase: Client, deps: Deps = {}): Promise<OfficeWelcomeOutcome> {
  const send = deps.send ?? sendEmail;
  const env = deps.env ?? process.env;
  if (!welcomeSwitchedOn(env)) return "switched_off";
  if (!supabase.rpc || !supabase.auth) return "failed";

  let claimed = false;
  try {
    const { data, error } = await supabase.rpc("claim_office_agent_welcome");
    if (error || data !== true) return "not_claimed";
    claimed = true;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("no user");
    const { data: me } = await supabase.from("profiles").select("email, full_name").eq("id", user.id).maybeSingle();
    const profile = me as { email: string | null; full_name: string | null } | null;
    const to = (profile?.email ?? user.email ?? "").trim();
    if (!to) throw new Error("no address");

    const { data: adoption } = await supabase.rpc("office_annexure_adoption");
    const adopted = Array.isArray(adoption) && adoption.length > 0;
    const base = appBaseUrl(env);

    const sent = await sendWelcome(send, to, {
      firstName: firstNameOf(profile?.full_name ?? null),
      base,
      box: {
        kind: "office_sg",
        annexureUrl: adopted ? readAnnexureUrl(base) : null,
        sgUrl: supervisionGuidelinesUrl(base),
      },
    });
    if (!sent) throw new Error("send failed");
    return "sent";
  } catch (err) {
    console.error("agent welcome (office) failed:", err instanceof Error ? err.message : err);
    if (claimed) {
      try {
        await supabase.rpc("release_office_agent_welcome");
      } catch {
        // Logged above; a claim left in place only means no second attempt.
      }
    }
    return "failed";
  }
}

// ── The staff page's test copy (brief, 14 Oct 2026) ─────────────────────
//
// As sendTestWelcome (lib/early-access/welcome.ts): only to Adam's test
// addresses, "[Test]" in front of the subject, no copy to admin@, nothing
// recorded, and the welcome switch is ignored. The video link and the
// download point at the live site, as in the real email; the office box's
// two links point at this deployment, so on a pull request's preview they
// open the preview's new pages.
//
// The picture travels inside the test email (cid) rather than from the live
// site, because until this is merged the live site does not have it. The
// real email loads it from the site, like the licensee welcome's.

export type TestAgentWelcomeKind = "own_plan" | "office_adopted" | "office_not_adopted";

const PICTURE_CID = "agent-video";

async function agentVideoPicture(): Promise<Uint8Array> {
  const { GET } = await import("@/app/email-agent-video.png/route");
  return new Uint8Array(await GET().arrayBuffer());
}

export async function sendTestAgentWelcome(
  input: { to: string; firstName: string | null; kind: TestAgentWelcomeKind },
  deps: Deps & { picture?: () => Promise<Uint8Array> } = {},
): Promise<{ error: string | null; notice?: string }> {
  const send = deps.send ?? sendEmail;
  const env = deps.env ?? process.env;
  const to = input.to.trim();
  if (!isTestAddress(to)) {
    return { error: "Test copies only go to your test addresses (getadamc3+…@gmail.com)." };
  }

  const live = appBaseUrl({ NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL });
  const here = appBaseUrl(env);
  const box: AgentWelcomeInput["box"] =
    input.kind === "own_plan"
      ? { kind: "download", url: `${live}/annexure/download` }
      : {
          kind: "office_sg",
          annexureUrl: input.kind === "office_adopted" ? readAnnexureUrl(here) : null,
          sgUrl: supervisionGuidelinesUrl(here),
        };
  const { subject, text, html } = buildAgentWelcomeEmail({ firstName: input.firstName, base: live, box });

  let picture: Uint8Array;
  try {
    picture = await (deps.picture ?? agentVideoPicture)();
  } catch (err) {
    console.error("test agent welcome: picture failed", err);
    return { error: "The test email couldn't be built. Try again in a minute." };
  }
  const sent = await send({
    to,
    replyTo: ADMIN_COPY_ADDRESS,
    fromName: SENDER_NAME,
    subject: `[Test] ${subject}`,
    text,
    html: html.split(`${live}/email-agent-video.png`).join(`cid:${PICTURE_CID}`),
    attachments: [{ filename: "agent-video.png", content: picture, contentType: "image/png", cid: PICTURE_CID }],
  });
  if (!sent) return { error: "The test email couldn't be sent. Try again in a minute." };
  return { error: null, notice: `Test agent welcome sent to ${to}.` };
}
