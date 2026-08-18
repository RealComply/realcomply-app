import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { computePropertyDigests, daysSinceActivity, type PropertyDigest } from "@/lib/property-digest";
import { expiryStatus } from "@/lib/expiry-status";
import { credentialLabel } from "@/lib/licence-reminders";
import { STAGE_LABELS, type Agency, type Profile, type Property, type PropertyItem, type TrainingSession } from "@/lib/types";

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
};

async function loadAgencyBundle(
  supabase: ReturnType<typeof createServiceClient>,
  agency: Agency,
): Promise<AgencyBundle> {
  const [{ data: properties }, { data: profiles }, { data: trainingSessions }] = await Promise.all([
    supabase.from("properties").select("*").eq("agency_id", agency.id),
    supabase.from("profiles").select("*").eq("agency_id", agency.id),
    supabase
      .from("training_sessions")
      .select("session_date")
      .eq("agency_id", agency.id)
      .order("session_date", { ascending: false })
      .limit(1),
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

  const digests = computePropertyDigests(propertyList, itemsByProperty);
  const lastTrainingSessionDate = ((trainingSessions as Pick<TrainingSession, "session_date">[] | null) ?? [])[0]?.session_date ?? null;

  return { agency, properties: propertyList, profiles: profileList, digests, lastTrainingSessionDate };
}

function agentName(profiles: Profile[], id: string): string {
  return profiles.find((p) => p.id === id)?.full_name || profiles.find((p) => p.id === id)?.email || "Unknown agent";
}

function renderDigestSection(title: string, digests: PropertyDigest[], profiles: Profile[]): string {
  const needsYou = digests.filter((d) => d.pendingSignoff.length > 0 || d.flagged.length > 0);
  const dueForReview = digests.filter((d) => {
    const days = daysSinceActivity(d.lastActivityAt);
    return d.property.stage < 5 && (days === null || days > 7);
  });

  const lines: string[] = [`${title}`, "=".repeat(title.length)];

  lines.push("", `Needs attention (${needsYou.length})`);
  if (needsYou.length === 0) {
    lines.push("  Nothing needs attention right now.");
  } else {
    for (const d of needsYou) {
      const items = [...d.pendingSignoff, ...d.flagged].map((i) => i.label).join(", ");
      lines.push(`  - ${d.property.address} (${STAGE_LABELS[d.property.stage]}, ${agentName(profiles, d.property.created_by)}): ${items}`);
    }
  }

  lines.push("", `Due for weekly review (${dueForReview.length})`);
  if (dueForReview.length === 0) {
    lines.push("  Every active file has had activity this week.");
  } else {
    for (const d of dueForReview) {
      const days = daysSinceActivity(d.lastActivityAt);
      lines.push(`  - ${d.property.address}: ${days === null ? "no activity yet" : `${days} days since last activity`}`);
    }
  }

  return lines.join("\n");
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
function renderLicenceAndPiSection(agency: Agency, profiles: Profile[]): string {
  const concerning = (s: ReturnType<typeof expiryStatus>) => s === "expired" || s === "urgent" || s === "soon";
  const phrase = (s: ReturnType<typeof expiryStatus>) =>
    s === "expired" ? "has expired" : s === "urgent" ? "expires within 30 days" : "expires within 3 months";

  const expiringStaff = profiles.filter((p) => concerning(expiryStatus(p.licence_expiry)));
  const piConcern = expiryStatus(agency.pi_expiry);
  const corpConcern = expiryStatus(agency.corporation_licence_expiry);

  if (expiringStaff.length === 0 && !concerning(piConcern) && !concerning(corpConcern)) {
    return "";
  }

  const lines = ["", "Licences & insurance", "===================="];
  if (concerning(piConcern)) {
    lines.push(`  - PI insurance ${phrase(piConcern)}.`);
  }
  if (concerning(corpConcern)) {
    lines.push(`  - The agency's corporation licence ${phrase(corpConcern)} (${agency.corporation_licence_expiry}).`);
  }
  for (const p of expiringStaff) {
    const status = expiryStatus(p.licence_expiry);
    lines.push(
      `  - ${p.full_name ?? p.email}: ${credentialLabel(p.licence_type)} ${phrase(status)} (${p.licence_expiry}).`,
    );
  }
  lines.push("  Renewals are made with NSW Fair Trading. Update the date in the register once one comes through.");
  return lines.join("\n");
}

// The agent's own credential, in the agent's own email.
//
// Before this, the only person told about an expiring licence was the
// licensee — which is the wrong way round for the person who actually has to
// renew it. The dedicated daily reminder job (lib/email/licence-reminders.ts)
// is the real mechanism; this is the weekly backstop, so a credential inside
// three months is visible in both places rather than depending on one email
// having been opened three months ago.
function renderOwnCredentialSection(profile: Profile): string {
  const status = expiryStatus(profile.licence_expiry);
  if (status !== "expired" && status !== "urgent" && status !== "soon") return "";

  const label = credentialLabel(profile.licence_type);
  const lines = ["", "Your licence", "============"];
  lines.push(
    status === "expired"
      ? `  - Your ${label} expired on ${profile.licence_expiry}.`
      : `  - Your ${label} expires on ${profile.licence_expiry}.`,
  );
  return lines.join("\n");
}

// Same "flag only when it's actually due" shape as renderLicenceAndPiSection
// above — returns "" (nothing added) when there's a session on record within
// the reminder window, so this only ever shows up when it's genuinely worth
// the licensee's attention.
function renderTrainingSection(lastTrainingSessionDate: string | null): string {
  const days = daysSinceActivity(lastTrainingSessionDate);
  if (days !== null && days <= TRAINING_REMINDER_DAYS) return "";

  const lines = ["", "Training", "========"];
  lines.push(
    days === null
      ? "  - No training session logged yet."
      : `  - ${days} days since the last logged training session — worth booking one in.`,
  );
  return lines.join("\n");
}

const FOOTER =
  "\n\n---\nRealComply provides diligence support to help you stay on top of compliance. " +
  "It doesn't guarantee compliance and doesn't replace your own judgement — you decide.\n" +
  "View the live picture any time at https://realcomply.com.au/dashboard/portfolio";

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
    const trainingSection = renderTrainingSection(bundle.lastTrainingSessionDate);

    for (const profile of bundle.profiles) {
      if (!profile.is_agent && !profile.is_licensee_in_charge) {
        skipped += 1;
        continue;
      }

      const sections: string[] = [`Weekly compliance digest — ${bundle.agency.name}`, ""];

      if (profile.is_agent) {
        const ownDigests = bundle.digests.filter((d) => d.property.created_by === profile.id);
        sections.push(renderDigestSection("Your listings", ownDigests, bundle.profiles));
        const ownCredential = renderOwnCredentialSection(profile);
        if (ownCredential) sections.push(ownCredential);
      }

      if (profile.is_licensee_in_charge) {
        sections.push("");
        sections.push(renderDigestSection("Whole agency", bundle.digests, bundle.profiles));
        if (licenceSection) sections.push(licenceSection);
        if (trainingSection) sections.push(trainingSection);
      }

      const text = sections.join("\n") + FOOTER;
      const subject = profile.is_licensee_in_charge
        ? `Weekly digest — ${bundle.agency.name}`
        : `Your weekly digest — ${bundle.agency.name}`;

      const ok = await sendEmail({ to: profile.email, subject, text });
      if (ok) sent += 1;
      else failed += 1;
    }
  }

  return { sent, skipped, failed };
}
