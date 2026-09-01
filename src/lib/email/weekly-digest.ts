import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import {
  renderEmailHtml,
  renderEmailText,
  DILIGENCE_LINE,
  type EmailDocument,
  type EmailSection,
  type EmailRow,
} from "./layout";
import {
  computePropertyDigests,
  daysSinceActivity,
  awaitingAgentReview,
  type PropertyDigest,
} from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { credentialLabel } from "@/lib/licence-reminders";
import { currentCpdYear } from "@/lib/cpd-year";
import {
  STAGE_LABELS,
  type Agency,
  type Profile,
  type Property,
  type PropertyItem,
  type TrainingPlan,
  type TrainingSession,
} from "@/lib/types";

// Office training frequency isn't prescribed — s32 is outcome-based, the
// agency sets its own cadence — but "defaults quarterly" (see
// src/app/dashboard/training/page.tsx) has only ever lived as a code
// comment, never actually checked against anything. This is that check:
// 90 days is quarterly's rough length, and there's no per-agency cadence
// setting to read instead, so it's hardcoded the same way "quarterly" was
// already assumed everywhere else.
const TRAINING_REMINDER_DAYS = 90;

// Same computation the in-app "Office overview" page uses
// (src/app/dashboard/portfolio/page.tsx) — the Monday email is meant to be
// the same picture, just pushed instead of pulled, so it deliberately
// doesn't invent a different notion of "needs attention."

type AgencyBundle = {
  agency: Agency;
  properties: Property[];
  profiles: Profile[];
  digests: PropertyDigest[];
  lastTrainingSessionDate: string | null;
  trainingPlans: TrainingPlan[];
};

async function loadAgencyBundle(
  supabase: ReturnType<typeof createServiceClient>,
  agency: Agency,
): Promise<AgencyBundle> {
  const [{ data: properties }, { data: profiles }, { data: trainingSessions }, { data: planRows }] = await Promise.all([
    supabase.from("properties").select("*").eq("agency_id", agency.id),
    supabase.from("profiles").select("*").eq("agency_id", agency.id),
    supabase
      .from("training_sessions")
      .select("session_date")
      .eq("agency_id", agency.id)
      .order("session_date", { ascending: false })
      .limit(1),
    supabase
      .from("training_plans")
      .select("*")
      .eq("agency_id", agency.id)
      .eq("cpd_year_start", currentCpdYear().start),
  ]);

  const propertyList = (properties ?? []) as Property[];
  const profileList = (profiles ?? []) as Profile[];
  const propertyIds = propertyList.map((p) => p.id);

  const { data: itemRows } =
    propertyIds.length > 0
      ? await supabase.from("property_items").select("*").in("property_id", propertyIds)
      : { data: [] as PropertyItem[] };

  const itemsByProperty = new Map<string, Map<string, PropertyItem>>();
  for (const row of (itemRows ?? []) as PropertyItem[]) {
    if (!itemsByProperty.has(row.property_id)) itemsByProperty.set(row.property_id, new Map());
    itemsByProperty.get(row.property_id)!.set(row.item_key, row);
  }

  // Who counts as a licensee in charge, for the Settled-stage split between
  // "Send to licensee" and "Licensee signature". One query, not one per file.
  const { data: licenseeRows } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_licensee_in_charge", true);
  const licenseeIds = new Set(((licenseeRows ?? []) as { id: string }[]).map((r) => r.id));

  const digests = computePropertyDigests(propertyList, itemsByProperty, licenseeIds);
  const lastTrainingSessionDate = ((trainingSessions as Pick<TrainingSession, "session_date">[] | null) ?? [])[0]?.session_date ?? null;

  return {
    agency,
    properties: propertyList,
    profiles: profileList,
    digests,
    lastTrainingSessionDate,
    trainingPlans: (planRows ?? []) as TrainingPlan[],
  };
}

function agentName(profiles: Profile[], id: string): string {
  return profiles.find((p) => p.id === id)?.full_name || profiles.find((p) => p.id === id)?.email || "Unknown agent";
}

function renderDigestSection(
  title: string,
  digests: PropertyDigest[],
  profiles: Profile[],
): EmailSection[] {
  const needsYou = digests.filter(
    (d) => d.pendingSignoff.length > 0 || d.flagged.length > 0 || d.awaiting.length > 0,
  );
  const dueForReview = digests.filter((d) => {
    const days = daysSinceActivity(d.lastActivityAt);
    return d.property.stage < 5 && (days === null || days > 7);
  });

  const out: EmailSection[] = [{ kind: "label", text: `${title} — needs attention` }];

  if (needsYou.length === 0) {
    out.push({ kind: "note", text: "Nothing needs attention right now." });
  } else {
    out.push({
      kind: "rows",
      rows: needsYou.map((d) => ({
        title: d.property.address,
        sub: `${STAGE_LABELS[d.property.stage]} · ${agentName(profiles, d.property.created_by)}`,
        detail: [...d.pendingSignoff, ...d.flagged, ...d.awaiting].map((i) => i.label).join(", "),
        // A flag is a live compliance or pricing problem; a pending signature
        // is work waiting on a person. Different colours because they are
        // different kinds of urgent.
        tone: d.flagged.length > 0 ? ("risk" as const) : ("attention" as const),
      })),
    });
  }

  out.push({ kind: "label", text: "Due for weekly review" });
  if (dueForReview.length === 0) {
    out.push({ kind: "note", text: "Every active file has had activity this week." });
  } else {
    out.push({
      kind: "rows",
      rows: dueForReview.map((d) => {
        const days = daysSinceActivity(d.lastActivityAt);
        return {
          title: d.property.address,
          sub: days === null ? "no activity yet" : `${days} days since last activity`,
          tone: "routine" as const,
        };
      }),
    });
  }

  return out;
}

// Widened from 30 days to 90 (Adam, 18 Aug 2026), matching the first
// reminder threshold in lib/licence-reminders.ts. Thirty days is late for a
// licensee: it is not enough time to arrange cover if someone's certificate
// isn't going to be renewed, and a certificate of registration can't be
// renewed a second time at all — an assistant at the end of theirs has to
// have qualified for a Class 2 licence, which is months of work, not weeks.
//
// The corporation licence is included here too. It sits on the agency row
// rather than on anyone's profile, so it was silently absent from the one
// email whose whole job is telling the licensee what is about to lapse.
// Files an assistant has prepared and handed to an agent. Licensee section
// only: it is a supervision picture, not a to-do — the agent already gets
// these at the top of their own Home page.
function renderAwaitingAgentSection(properties: Property[], profiles: Profile[]): EmailSection[] {
  const waiting = awaitingAgentReview(properties);
  if (waiting.length === 0) return [];

  return [
    { kind: "label", text: "Waiting on an agent" },
    {
      kind: "rows",
      rows: waiting.map((p) => {
        const since = p.review_requested_at
          ? new Date(p.review_requested_at).toLocaleDateString("en-AU", {
              weekday: "short",
              day: "numeric",
              month: "short",
            })
          : "recently";
        const preparer = p.review_requested_by ? agentName(profiles, p.review_requested_by) : "an assistant";
        return {
          title: p.address,
          sub: `prepared by ${preparer}`,
          detail: `With ${agentName(profiles, p.created_by)} since ${since}`,
          tone: "attention" as const,
        };
      }),
    },
    {
      kind: "note",
      text: "Prepared, not signed. The agent's signature is what attests to the file.",
    },
  ];
}

// ISO dates are how the database stores an expiry; they are not how a person
// reads one. "2026-11-21" in an email to a licensee reads as machine output.
function humanDate(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function renderLicenceAndPiSection(agency: Agency, profiles: Profile[]): EmailSection[] {
  const concerning = (s: ReturnType<typeof expiryStatus>) => s === "expired" || s === "urgent" || s === "soon";
  const phrase = (s: ReturnType<typeof expiryStatus>) =>
    s === "expired" ? "has expired" : s === "urgent" ? "expires within 30 days" : "expires within 3 months";
  // Expired is a risk today. Anything still in the future is attention.
  const tone = (s: ReturnType<typeof expiryStatus>) =>
    s === "expired" ? ("risk" as const) : ("attention" as const);

  const expiringStaff = profiles.filter((p) => concerning(expiryStatus(p.licence_expiry)));
  const piConcern = expiryStatus(agency.pi_expiry);
  const corpConcern = expiryStatus(agency.corporation_licence_expiry);

  if (expiringStaff.length === 0 && !concerning(piConcern) && !concerning(corpConcern)) {
    return [];
  }

  const rows: EmailRow[] = [];
  if (concerning(piConcern)) {
    rows.push({ title: "Professional indemnity insurance", detail: `PI insurance ${phrase(piConcern)}.`, tone: tone(piConcern) });
  }
  if (concerning(corpConcern)) {
    rows.push({
      title: "Agency corporation licence",
      sub: humanDate(agency.corporation_licence_expiry),
      detail: `The agency's corporation licence ${phrase(corpConcern)}.`,
      tone: tone(corpConcern),
    });
  }
  for (const p of expiringStaff) {
    const status = expiryStatus(p.licence_expiry);
    rows.push({
      title: p.full_name ?? p.email,
      sub: humanDate(p.licence_expiry),
      detail: `${credentialLabel(p.licence_type)} ${phrase(status)}.`,
      tone: tone(status),
    });
  }

  return [
    { kind: "label", text: "Licences & insurance" },
    { kind: "rows", rows },
    {
      kind: "note",
      text: "Renewals are made with NSW Fair Trading. Update the date in the register once one comes through.",
    },
  ];
}

// The agent's own credential, in the agent's own email.
//
// Before this, the only person told about an expiring licence was the
// licensee — which is the wrong way round for the person who actually has to
// renew it. The dedicated daily reminder job (lib/email/licence-reminders.ts)
// is the real mechanism; this is the weekly backstop, so a credential inside
// three months is visible in both places rather than depending on one email
// having been opened three months ago.
function renderOwnCredentialSection(profile: Profile): EmailSection[] {
  const status = expiryStatus(profile.licence_expiry);
  if (status !== "expired" && status !== "urgent" && status !== "soon") return [];

  const label = credentialLabel(profile.licence_type);
  return [
    { kind: "label", text: "Your licence" },
    {
      kind: "rows",
      rows: [
        {
          title: label,
          sub: humanDate(profile.licence_expiry),
          detail:
            status === "expired"
              ? `Your ${label} expired on ${humanDate(profile.licence_expiry)}.`
              : `Your ${label} expires on ${humanDate(profile.licence_expiry)}.`,
          tone: status === "expired" ? ("risk" as const) : ("attention" as const),
        },
      ],
    },
  ];
}

// Same "flag only when it's actually due" shape as renderLicenceAndPiSection
// above — returns "" (nothing added) when there's a session on record within
// the reminder window, so this only ever shows up when it's genuinely worth
// the licensee's attention.
function renderTrainingSection(
  lastTrainingSessionDate: string | null,
  profiles: Profile[],
  plans: TrainingPlan[],
  cpdYearLabel: string,
): EmailSection[] {
  const days = daysSinceActivity(lastTrainingSessionDate);
  const staleSessions = days === null || days > TRAINING_REMINDER_DAYS;

  // Requirement 2.4 of the Supervision Guidelines: a plan per staff member
  // per CPD year, developed in consultation and signed by both. The licensee
  // is the one who carries this, so it belongs in the licensee's digest — and
  // "who hasn't got one" is exactly the question they'd otherwise have to go
  // looking for.
  const planByProfile = new Map(plans.map((p) => [p.profile_id, p]));
  const noPlan = profiles.filter((p) => (p.is_agent || p.is_licensee_in_charge) && !planByProfile.has(p.id));
  const unapproved = profiles.filter((p) => {
    const plan = planByProfile.get(p.id);
    return plan && !plan.principal_signed_at;
  });

  if (!staleSessions && noPlan.length === 0 && unapproved.length === 0) return [];

  const out: EmailSection[] = [{ kind: "label", text: "Training" }];

  if (staleSessions) {
    out.push({
      kind: "note",
      text:
        days === null
          ? "No training session logged yet."
          : `${days} days since the last logged training session. Worth booking one in.`,
    });
  }

  const rows: EmailRow[] = [
    ...noPlan.map((p) => ({
      title: p.full_name ?? p.email,
      detail: `No ${cpdYearLabel} training plan yet.`,
      tone: "attention" as const,
    })),
    ...unapproved.map((p) => ({
      title: p.full_name ?? p.email,
      detail: "Training plan started but not signed off.",
      tone: "attention" as const,
    })),
  ];
  if (rows.length > 0) out.push({ kind: "rows", rows });

  return out;
}

const PORTFOLIO_URL = "https://www.realcomply.com.au/dashboard/portfolio";

const DIGEST_FOOTER = [
  DILIGENCE_LINE,
  `<a href="${PORTFOLIO_URL}" style="color:#8a9a93">View the live picture any time</a>`,
];

// Runs the whole weekly digest: one pass per agency, one email per
// recipient. A profile with both is_agent and is_licensee_in_charge (a
// sole principal, most commonly) gets ONE combined email rather than two —
// separately mailing someone their own "per-agent" view and then the
// agency-wide view a minute later reads as a bug, not a feature.
export async function runWeeklyDigest(): Promise<{ sent: number; skipped: number; failed: number }> {
  const supabase = createServiceClient();
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const { data: agencies } = await supabase.from("agencies").select("*");

  for (const agency of (agencies ?? []) as Agency[]) {
    const bundle = await loadAgencyBundle(supabase, agency);
    const licenceSection = renderLicenceAndPiSection(bundle.agency, bundle.profiles);
    const trainingSection = renderTrainingSection(
      bundle.lastTrainingSessionDate,
      bundle.profiles,
      bundle.trainingPlans,
      currentCpdYear().label,
    );

    for (const profile of bundle.profiles) {
      if (!profile.is_agent && !profile.is_licensee_in_charge) {
        skipped += 1;
        continue;
      }

      const sections: EmailSection[] = [];

      // The count that leads the email. Scoped to what this recipient is
      // actually responsible for, so an agent is never shown a number that
      // includes files they cannot act on.
      const scope = profile.is_licensee_in_charge
        ? bundle.digests
        : bundle.digests.filter((d) => d.property.created_by === profile.id);
      const needsYouCount = scope.filter(
        (d) => d.pendingSignoff.length > 0 || d.flagged.length > 0 || d.awaiting.length > 0,
      ).length;

      sections.push({
        kind: "counter",
        n: needsYouCount,
        caption: needsYouCount === 1 ? "file needs you this week" : "files need you this week",
        tone: needsYouCount === 0 ? "good" : "warn",
      });

      if (profile.is_agent) {
        const ownDigests = bundle.digests.filter((d) => d.property.created_by === profile.id);
        sections.push(...renderDigestSection("Your listings", ownDigests, bundle.profiles));
        sections.push(...renderOwnCredentialSection(profile));
      }

      if (profile.is_licensee_in_charge) {
        sections.push(...renderDigestSection("Whole agency", bundle.digests, bundle.profiles));
        sections.push(...renderAwaitingAgentSection(bundle.properties, bundle.profiles));
        sections.push(...licenceSection);
        sections.push(...trainingSection);
      }

      sections.push({ kind: "button", label: "Open the portfolio", href: PORTFOLIO_URL });

      const doc: EmailDocument = {
        // Written rather than inherited: left alone the client would fill the
        // inbox preview line with the agency name it already shows in the
        // subject. The counts are what make it worth opening.
        preheader:
          needsYouCount === 0
            ? "Nothing needs you this week."
            : `${needsYouCount} ${needsYouCount === 1 ? "file needs" : "files need"} you this week.`,
        title: "Weekly digest",
        meta: `${bundle.agency.name} · ${new Date().toLocaleDateString("en-AU", {
          weekday: "long",
          day: "numeric",
          month: "long",
          timeZone: "Australia/Sydney",
        })}`,
        sections,
        footer: DIGEST_FOOTER,
      };

      const subject = profile.is_licensee_in_charge
        ? `Weekly digest — ${bundle.agency.name}`
        : `Your weekly digest — ${bundle.agency.name}`;

      const ok = await sendEmail({
        to: profile.email,
        subject,
        text: renderEmailText(doc),
        html: renderEmailHtml(doc),
      });
      if (ok) sent += 1;
      else failed += 1;
    }
  }

  return { sent, skipped, failed };
}
