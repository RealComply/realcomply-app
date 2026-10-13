import { sendEmail, type SendEmailInput } from "@/lib/email/send";
import { ADMIN_COPY_ADDRESS, SENDER_NAME, type AnnexureBox } from "@/lib/email/early-access-invite";
import { buildAnnexureRequestEmail } from "@/lib/email/sg-annexure";
import { sendEarlyAccessWelcome, type WelcomeOutcome } from "@/lib/early-access/welcome";
import { annexureDate, SG_ANNEXURE_VERSION } from "@/lib/legal/sg-annexure";
import { appBaseUrl } from "@/lib/site-url";

// A new office's trial has started: its welcome, and the request to adopt the
// SG annexure (brief, 14 Oct 2026; Adam, 14 Oct 2026: "send the licensee's
// signing email to every new office, whether or not it came through early
// access. Early access offices get the box in the welcome email; any other
// new office gets the short signing email on its own").
//
//   - Early access, and the person who signed up is the licensee in charge
//     (or an agent on their own plan): the welcome carries the box with the
//     "Review and sign" button. Nothing else is sent.
//   - Early access, signed up by someone else: the welcome's box says "We've
//     sent the annexure to [licensee] to sign", and the short signing email
//     goes to the licensee's recorded email.
//   - Any other new office, or a welcome that did not go: the short signing
//     email goes to the licensee on its own.
//
// ONCE. Stripe sends more than one event for a new subscription. The office's
// one 'new_office' link is claimed by inserting it (0067's unique index), so a
// second event finds it taken and sends nothing. A request email that fails
// gives the claim back, so the next event tries again.
//
// NEVER THROWS, like the welcome: a 500 would make Stripe retry an update that
// has already succeeded. Server only, with the service key: the webhook has no
// signed-in person.

type Client = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type AnnexureRequestOutcome =
  | "in_welcome" // the welcome's button is the link
  | "emailed" // the short signing email went to the licensee
  | "already_requested"
  | "already_adopted"
  | "no_licensee_email"
  | "failed";

export type NewOfficePlan = {
  agencyName: string;
  licenceNumber: string | null;
  /** The person who signed up is the licensee in charge, or an agent on their own plan. */
  signerIsLicensee: boolean;
  licensee: { name: string | null; email: string };
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_licensee_in_charge: boolean;
  is_assistant: boolean;
  licence_number: string | null;
  archived_at: string | null;
  created_at: string;
};

const clean = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim();
  return t ? t : null;
};

/**
 * Who the annexure goes to, and who signed up. Null when there is nothing to
 * ask: the office has adopted already, or has no licensee email on file.
 */
export async function annexurePlanFor(
  supabase: Client,
  agencyId: string,
): Promise<{ plan: NewOfficePlan | null; reason?: "already_adopted" | "no_licensee_email" }> {
  const [{ data: agency }, { data: people }, { data: adopted }, { data: invites }] = await Promise.all([
    supabase
      .from("agencies")
      .select("name, plan, licensee_name, licensee_email, corporation_licence_number")
      .eq("id", agencyId)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("id, full_name, email, is_licensee_in_charge, is_assistant, licence_number, archived_at, created_at")
      .eq("agency_id", agencyId),
    supabase.from("sg_annexure_adoptions").select("id").eq("agency_id", agencyId),
    supabase.from("founder_invites").select("accepted_by").eq("agency_id", agencyId).not("accepted_at", "is", null),
  ]);
  if (((adopted ?? []) as unknown[]).length > 0) return { plan: null, reason: "already_adopted" };

  const a = (agency ?? {}) as {
    name?: string;
    plan?: string | null;
    licensee_name?: string | null;
    licensee_email?: string | null;
    corporation_licence_number?: string | null;
  };
  const present = ((people ?? []) as ProfileRow[])
    .filter((p) => !p.archived_at)
    .sort((x, y) => x.created_at.localeCompare(y.created_at));
  const agentPlan = (a.plan ?? "").startsWith("agent_");

  // The person who signed up: the one the invitation was accepted by, or the
  // account holder (the first person in the office, as 0059 counts it).
  const acceptedBy = ((invites ?? []) as Array<{ accepted_by: string | null }>).find((i) => i.accepted_by)?.accepted_by;
  const signer = present.find((p) => p.id === acceptedBy) ?? present[0] ?? null;
  const actsAsLicensee = (p: ProfileRow) => p.is_licensee_in_charge || (agentPlan && !p.is_assistant);
  const signerIsLicensee = Boolean(signer && actsAsLicensee(signer));

  // The licensee: the person who signed up, if it's them; otherwise a
  // licensee in charge in the office; otherwise the one recorded at sign-up.
  const member = signerIsLicensee ? signer : present.find((p) => p.is_licensee_in_charge) ?? null;
  const email = clean(member?.email) ?? clean(a.licensee_email);
  if (!email) return { plan: null, reason: "no_licensee_email" };

  const licensee = { name: clean(member?.full_name) ?? clean(a.licensee_name), email: email.toLowerCase() };
  const licenceNumber =
    clean(a.corporation_licence_number) ??
    clean(present.find((p) => actsAsLicensee(p) && clean(p.licence_number))?.licence_number);

  return {
    plan: {
      agencyName: clean(a.name) ?? "Your agency",
      licenceNumber,
      signerIsLicensee,
      licensee,
    },
  };
}

export function annexureSignUrl(token: string, base = appBaseUrl()): string {
  return `${base}/annexure/${token}`;
}

export async function onNewOfficeTrialStarted(
  supabase: Client,
  agencyId: string,
  deps: {
    send?: (input: SendEmailInput) => Promise<boolean>;
    env?: Record<string, string | undefined>;
    now?: Date;
  } = {},
): Promise<{ welcome: WelcomeOutcome; annexure: AnnexureRequestOutcome }> {
  const send = deps.send ?? sendEmail;
  const env = deps.env ?? process.env;
  const now = deps.now ?? new Date();

  let plan: NewOfficePlan | null = null;
  let annexure: AnnexureRequestOutcome = "failed";
  let link: { id: string; token: string } | null = null;
  let claimedNow = false;

  try {
    const found = await annexurePlanFor(supabase, agencyId);
    plan = found.plan;
    if (!plan) annexure = found.reason ?? "failed";
    else {
      const { data, error } = await supabase
        .from("sg_annexure_links")
        .insert({ agency_id: agencyId, sent_to: plan.licensee.email, purpose: "new_office" })
        .select("id, token")
        .maybeSingle();
      if (!error && data) {
        link = data as { id: string; token: string };
        claimedNow = true;
      } else if (error?.code === "23505") {
        // Claimed by an earlier event. Its link still goes in a welcome that
        // has not gone yet; nothing else is sent again.
        annexure = "already_requested";
        const { data: existing } = await supabase
          .from("sg_annexure_links")
          .select("id, token, used_at")
          .eq("agency_id", agencyId)
          .eq("purpose", "new_office")
          .maybeSingle();
        const row = existing as { id: string; token: string; used_at: string | null } | null;
        if (row && !row.used_at) link = row;
      } else {
        console.error("annexure request: could not claim the link", agencyId, error?.message);
      }
    }
  } catch (err) {
    console.error("annexure request: plan failed", agencyId, err);
  }

  const base = appBaseUrl(env);
  const date = annexureDate(now);
  const box: AnnexureBox | null =
    plan && link
      ? plan.signerIsLicensee
        ? { kind: "sign", agencyName: plan.agencyName, licenceNumber: plan.licenceNumber, date, url: annexureSignUrl(link.token, base) }
        : { kind: "sent", licenseeName: plan.licensee.name ?? "your licensee in charge" }
      : null;

  const welcome = await sendEarlyAccessWelcome(supabase, agencyId, { send, env, annexure: box });

  if (plan && link && claimedNow) {
    if (welcome === "sent" && plan.signerIsLicensee) {
      annexure = "in_welcome";
    } else {
      let ok = false;
      try {
        const { subject, text, html } = buildAnnexureRequestEmail({
          licenseeName: plan.licensee.name,
          box: { kind: "sign", agencyName: plan.agencyName, licenceNumber: plan.licenceNumber, date, url: annexureSignUrl(link.token, base) },
          base,
        });
        ok = await send({
          to: plan.licensee.email,
          bcc: ADMIN_COPY_ADDRESS,
          replyTo: ADMIN_COPY_ADDRESS,
          fromName: SENDER_NAME,
          subject,
          text,
          html,
        });
      } catch (err) {
        console.error("annexure request: send threw", agencyId, err);
      }
      if (ok) annexure = "emailed";
      else {
        // Give the claim back so the next event from Stripe tries again.
        try {
          await supabase.from("sg_annexure_links").delete().eq("id", link.id).is("used_at", null);
        } catch (err) {
          console.error("annexure request: could not release the claim", agencyId, err);
        }
        annexure = "failed";
        console.error("annexure request: send failed", { agencyId, version: SG_ANNEXURE_VERSION });
      }
    }
  }

  return { welcome, annexure };
}
