import { notFound } from "next/navigation";
import { KeyRound, Users, Building2, Ticket, Inbox } from "lucide-react";
import { requireProfile } from "@/lib/data/current-profile";
import { createServiceClient } from "@/lib/supabase/service";
import { formatAuDate } from "@/lib/format-date";
import { FounderInvites, type FounderInvite } from "@/components/admin/FounderInvites";
import { EarlyAccessQueue, type EarlyAccessRow } from "@/components/admin/EarlyAccessQueue";
import { WelcomeTest } from "@/components/admin/WelcomeTest";
import { CpdReminderTest } from "@/components/admin/CpdReminderTest";
import { PmAnnouncement, type PmAnnouncementListRow } from "@/components/admin/PmAnnouncement";
import { PM_ANNOUNCEMENT_TEST_ADDRESS, pmAnnouncementList } from "@/lib/email/pm-announcement";
import { cpdSendDatesThisYear } from "@/lib/actions/cpd-reminders-admin";
import { earlyAccessStatus, hiddenFromList, isTestAddress } from "@/lib/early-access/rules";
import { storageBackupConfigured, countEvidenceObjects } from "@/lib/backup/storage-backup";
import {
  DeleteNowForm,
  DryRunButton,
  LegalHoldForm,
  SendOwedEmailsButton,
} from "@/components/admin/EndedSubscriptionControls";
import { deletionDate, longDate, sydneyDate } from "@/lib/subscription-end/dates";

// Who is on RealComply — the only screen that looks across every agency.
//
// Adam, 9 Sep 2026: "how can I easily find anyone who has signed up to a
// working account?"
//
// He could already answer it, in the SQL editor, which is a fine way to ask a
// question once and a bad way to ask it every day while testers trickle in.
// This is the same three questions as who-can-get-in.sql, on a page.
//
// WHY IT NEEDS THE SERVICE KEY, and why that is the dangerous part. Every table
// in this product is scoped by current_agency_id() — that is the whole tenancy
// model, and it means an ordinary query here would return Cass Property and
// nothing else no matter who is asking. Looking across agencies requires
// bypassing row-level security, which is exactly the thing RLS exists to stop.
//
// So the check comes FIRST and the client is created SECOND. Nothing on this
// page is fetched until is_platform_admin has been read from the caller's own
// profile. Getting that order wrong would turn a staff page into a way for any
// signed-in agent to read every agency in the system.
//
// notFound() rather than a redirect, deliberately. A page that redirects tells
// you it exists and you are not allowed in; a 404 tells you nothing. There is
// no reason for a customer to learn this URL is real.
//
// NOT A GENERAL ADMIN CONSOLE, and it should not become one. It reads. Anything
// that CHANGES another agency — comping, suspending, deleting — is a different
// kind of screen with a different standard of care, and there is exactly one
// agency today that anybody would want to change.
//
// ONE EXCEPTION, 8 Oct 2026: the legal hold switch under "Ended
// subscriptions". It can only ever STOP a deletion, never cause one, and Data
// Retention Policy section 6 needs a place to record it.

export const dynamic = "force-dynamic";

type AgencyRow = {
  id: string;
  name: string;
  status: string;
  plan: string;
  created_at: string;
  comped_reason: string | null;
};

type ProfileRow = {
  id: string;
  agency_id: string;
  full_name: string | null;
  email: string | null;
  is_licensee_in_charge: boolean | null;
  is_platform_admin: boolean | null;
  created_at: string | null;
};

type InviteRow = {
  token: string;
  label: string;
  email: string | null;
  first_name: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  expires_at: string;
  agency_id: string | null;
  /** Absent until 0098 has run. */
  free_account?: boolean;
};

export default async function AdminPage() {
  const profile = await requireProfile();

  // Before anything is read. See the note above — this ordering is the
  // security property, not a formality.
  if (profile.is_platform_admin !== true) {
    notFound();
  }

  const supabase = createServiceClient();

  const [
    { data: agencyRows },
    { data: profileRows },
    { data: inviteRows },
    { data: propertyRows },
    { data: expiredRows },
    { data: backupRows },
    { data: earlyAccessRows },
  ] = await Promise.all([
      supabase
        .from("agencies")
        .select("id, name, status, plan, created_at, comped_reason")
        .order("created_at", { ascending: true }),
      supabase
        .from("profiles")
        .select("id, agency_id, full_name, email, is_licensee_in_charge, is_platform_admin, created_at")
        .order("created_at", { ascending: true }),
      // Every column, so free_account comes through once 0098 has added it
      // and the list still loads before then.
      supabase
        .from("founder_invites")
        .select("*")
        .order("label", { ascending: true }),
      // Activity, not just existence. An agency that signed up and never added
      // a listing has not tested anything, and that is the single most useful
      // thing to know about a tester — it is the difference between "they are
      // in" and "they are using it".
      supabase.from("properties").select("id, agency_id, created_at"),
      // Expiry decided by the database's clock — see the note below.
      supabase.from("founder_invites").select("token").lt("expires_at", "now()"),
      // Backup health. A backup nobody looks at is a backup that has already
      // stopped and nobody knows — so the one number that matters (anything
      // not yet copied) is on the screen we open anyway.
      supabase.from("storage_backups").select("path, backed_up_at, last_error, attempts"),
      // The early-access queue. Read with the service key because 0013 makes
      // this table insert-only to a browser session — deliberately, so the
      // anon key cannot read the list back.
      // Unsubscribed rows are read too since 10 Oct 2026: the list has an
      // Unsubscribed tab, and seeing them is what stops anyone asking why a
      // name has gone missing.
      supabase
        .from("early_access")
        .select(
          "id, email, first_name, agency_name, phone, created_at, invited_at, invited_token, declined_at, declined_note, unsubscribed_at, welcome_sent_at",
        )
        .order("created_at", { ascending: false }),
    ]);

  const [{ data: endedRows }, { data: runRows }, { data: certRows }] = await Promise.all([
    supabase
      .from("agencies")
      .select("id, name, ended_at, ended_notice_sent_at, ended_reminder_sent_at, legal_hold, legal_hold_reason")
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: true }),
    supabase
      .from("deletion_runs")
      .select("id, agency_ref, dry_run, status, step, reason, counts, certificate_number, started_at")
      .order("started_at", { ascending: false })
      .limit(30),
    supabase.from("deletion_certificates").select("agency_ref, subscriber_name"),
  ]);
  const ended = (endedRows ?? []) as Array<{
    id: string;
    name: string;
    ended_at: string;
    ended_notice_sent_at: string | null;
    ended_reminder_sent_at: string | null;
    legal_hold: boolean;
    legal_hold_reason: string | null;
  }>;
  const runs = (runRows ?? []) as Array<{
    id: number;
    agency_ref: string;
    dry_run: boolean;
    status: string;
    step: string | null;
    reason: string | null;
    counts: Record<string, number> | null;
    certificate_number: string | null;
    started_at: string;
  }>;

  const agencies = (agencyRows ?? []) as AgencyRow[];
  // A deleted agency is named from its certificate; its row is gone.
  const nameFor = (ref: string) =>
    agencies.find((a) => a.id === ref)?.name ??
    ((certRows ?? []) as Array<{ agency_ref: string; subscriber_name: string }>).find((c) => c.agency_ref === ref)
      ?.subscriber_name ??
    ref.slice(0, 8);
  const profiles = (profileRows ?? []) as ProfileRow[];
  const invites = (inviteRows ?? []) as InviteRow[];
  const properties = (propertyRows ?? []) as Array<{ id: string; agency_id: string; created_at: string }>;

  const peopleIn = (agencyId: string) => profiles.filter((p) => p.agency_id === agencyId);
  const listingsIn = (agencyId: string) => properties.filter((p) => p.agency_id === agencyId);
  // For the CPD reminders test: offices whose people, archived included, are
  // all on Adam's test addresses (the action checks again).
  const madeUpOffices = agencies
    .filter((a) => {
      const people = peopleIn(a.id);
      return people.length > 0 && people.every((p) => isTestAddress(p.email ?? ""));
    })
    .map((a) => ({ id: a.id, name: a.name }));

  // Which invites have expired, answered by Postgres rather than by this
  // machine's clock. Two reasons, and the second is the real one. The linter
  // objects to Date.now() during render, correctly — but more importantly, the
  // clock that decides whether a link still works is the database's, because
  // that is where bootstrap_agency_v3 compares expires_at when the link is
  // actually used. Anything else can disagree with the thing that decides.
  const expiredTokens = new Set(
    ((expiredRows ?? []) as Array<{ token: string }>).map((r) => r.token),
  );

  const sydneyShort = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(iso));

  const inviteList: FounderInvite[] = invites.map((invite) => ({
    token: invite.token,
    label: invite.label,
    email: invite.email,
    firstName: invite.first_name,
    sentLabel: invite.sent_at ? sydneyShort(invite.sent_at, false) : null,
    acceptedAt: invite.accepted_at,
    expiresAt: invite.expires_at,
    agencyName: agencies.find((a) => a.id === invite.agency_id)?.name ?? null,
    expired: expiredTokens.has(invite.token),
    free: invite.free_account === true,
  }));

  const unusedInvites = inviteList.filter((i) => !i.acceptedAt && !i.expired);

  // Personal invites leaves out the links the early access list made: those
  // are labelled with the registrant's email and are worked from Early
  // access. Without this, every early access invitation would also show
  // under Personal invites as "not emailed" (12 Oct 2026).
  const earlyAccessEmails = new Set(
    ((earlyAccessRows ?? []) as Array<{ email: string | null }>).map((r) => String(r.email).trim().toLowerCase()),
  );
  const personalInvites = inviteList.filter(
    (i) => i.email !== null || !earlyAccessEmails.has(i.label.trim().toLowerCase()),
  );
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.realcomply.com.au";

  // Whether an invited registrant has actually arrived. Read from the invite
  // itself rather than by matching email addresses: bootstrap_agency_v3 stamps
  // accepted_at on the token it consumed, so this is the authoritative record
  // of arrival. Matching on email would be guesswork: people sign up with a
  // different address from the one they registered with more often than not.
  const acceptedAt = new Map(
    invites.filter((i) => i.accepted_at).map((i) => [i.token, i.accepted_at as string]),
  );

  const earlyAccess: EarlyAccessRow[] = ((earlyAccessRows ?? []) as Array<Record<string, string | null>>)
    // Adam's own test addresses are left off (brief, 10 Oct 2026).
    .filter((row) => !hiddenFromList(String(row.email)))
    .map((row) => {
      const signedUpAt = row.invited_token ? (acceptedAt.get(row.invited_token) ?? null) : null;
      return {
        id: String(row.id),
        email: String(row.email),
        firstName: row.first_name ?? null,
        agencyName: row.agency_name ?? null,
        phone: row.phone ?? null,
        registered: sydneyShort(String(row.created_at), true),
        invitedAt: row.invited_at ?? null,
        invitedLabel: row.invited_at ? sydneyShort(row.invited_at, false) : null,
        unsubscribedAt: row.unsubscribed_at ?? null,
        declinedAt: row.declined_at ?? null,
        declinedNote: row.declined_note ?? null,
        signedUpAt,
        signedUpLabel: signedUpAt ? sydneyShort(signedUpAt, false) : null,
        welcomeSent: Boolean(row.welcome_sent_at),
      };
    });

  const waitingOnDecision = earlyAccess.filter((r) => earlyAccessStatus(r) === "not_invited").length;

  const backups = (backupRows ?? []) as Array<{
    path: string;
    backed_up_at: string | null;
    last_error: string | null;
    attempts: number;
  }>;
  const backedUp = backups.filter((b) => b.backed_up_at);
  const backupFailures = backups.filter((b) => !b.backed_up_at && b.last_error);
  // The most recent successful copy. Silence here is the thing to notice: the
  // job runs hourly, so a timestamp older than a few hours means it has stopped.
  const lastBackupAt = backedUp
    .map((b) => b.backed_up_at as string)
    .sort()
    .at(-1);
  const backupConfigured = storageBackupConfigured();
  // The source side of the comparison. Counting copies alone cannot tell you
  // the backup is complete — see countEvidenceObjects. null means the bucket
  // could not be read at all, which is a failure, not a zero.
  const sourceCount = backupConfigured ? await countEvidenceObjects() : null;
  const backupIncomplete =
    backupConfigured && (sourceCount === null || sourceCount > backedUp.length);

  // The property management announcement (Adam, 22 Oct 2026): the five
  // offices as they stand now, and what's recorded for each.
  const sydneyWhen = (iso: string) =>
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Sydney",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  const pmAnnouncementRows: PmAnnouncementListRow[] = (await pmAnnouncementList(supabase)).map((r) => ({
    office: r.office,
    licenseeName: r.record ? r.record.recipient_name : r.licenseeName,
    email: r.record ? r.record.recipient : r.email,
    problem: r.problem,
    recorded: !r.record
      ? null
      : r.record.status === "sent"
        ? `Sent ${sydneyWhen(r.record.sent_at ?? r.record.created_at)}`
        : r.record.status === "failed"
          ? `Tried ${sydneyWhen(r.record.created_at)}, failed`
          : `Sending since ${sydneyWhen(r.record.created_at)}`,
  }));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-rc-red">
        <KeyRound size={13} aria-hidden="true" />
        RealComply staff
      </p>
      <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-rc-ink">Who&rsquo;s on RealComply</h1>
      <p className="mt-1.5 text-sm text-rc-muted">
        Every agency and every person, across the whole product. Only you can see this page.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={<Building2 size={14} />} label="Agencies" value={agencies.length} />
        <Stat icon={<Users size={14} />} label="People" value={profiles.length} />
        <Stat icon={<Ticket size={14} />} label="Invites left" value={unusedInvites.length} />
        {/* The one number on this page that is a to-do rather than a fact. */}
        <Stat icon={<Inbox size={14} />} label="Not invited yet" value={waitingOnDecision} />
      </div>

      {/* JUMP BAR. Adam, 12 Oct 2026: "right now it's just a long scroll down
          to different sections ... I need buttons at the top of the page to
          take me to each section." Sticky, so it is still there halfway down.
          Plain links to the headings' ids: no script, and the browser's back
          button returns to where you were. The headings carry a scroll
          margin so the bar never covers them. */}
      <nav
        aria-label="Jump to a section"
        className="sticky top-[var(--rc-userbar-h,0px)] z-10 -mx-4 mt-6 flex flex-wrap gap-1.5 border-b border-rc-border bg-rc-bg-alt/90 px-4 py-2.5 backdrop-blur-md"
      >
        {[
          { href: "#backup", label: "Document backup" },
          { href: "#agencies", label: "Agencies" },
          { href: "#ended", label: "Ended subscriptions" },
          { href: "#early-access", label: "Early access", count: waitingOnDecision },
          { href: "#personal-invites", label: "Personal invites" },
          { href: "#announcements", label: "Announcements" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-green-deep focus-visible:border-rc-green-deep focus-visible:outline-none"
          >
            {link.label}
            {link.count ? (
              <span className="rounded-full bg-[#fbf0dc] px-1.5 text-[11px] tabular-nums text-[#a3610a]">{link.count}</span>
            ) : null}
          </a>
        ))}
      </nav>

      {/* DOCUMENT BACKUP.
          Near the top because it is the thing that is silently fine until it
          is silently not. Supabase's own database backups exclude Storage —
          every uploaded agency agreement, contract and trust reconciliation —
          so this copy is the only one there is. See 0046 and
          lib/backup/storage-backup.ts. */}
      <h2 id="backup" className={sectionHeading}>Document backup</h2>
      <div
        className={`mt-3 rounded-card border bg-white p-4 shadow-card ${
          !backupConfigured || backupFailures.length > 0 || backupIncomplete
            ? "border-rc-red/40"
            : "border-rc-border"
        }`}
      >
        {!backupConfigured ? (
          <>
            <p className="text-sm font-bold text-rc-red">Not set up — uploaded documents are not backed up</p>
            <p className="mt-1 text-xs leading-relaxed text-rc-muted">
              Supabase&rsquo;s database backups do not include uploaded files. Until this is configured, the
              only copy of every agency agreement, contract and trust reconciliation is the live bucket. Add
              the four <span className="font-mono">BACKUP_*</span> variables in Vercel.
            </p>
          </>
        ) : (
          <>
            {sourceCount === null ? (
              <p className="text-sm font-bold text-rc-red">
                Can&rsquo;t read the documents to be backed up
              </p>
            ) : (
              <p className="text-sm text-rc-ink">
                <span className="font-bold">
                  {backedUp.length} of {sourceCount}
                </span>{" "}
                document{sourceCount === 1 ? "" : "s"} copied to the backup bucket
                {lastBackupAt ? ` · last ${formatAuDate(lastBackupAt.slice(0, 10))}` : ""}
              </p>
            )}
            {sourceCount === null ? (
              <p className="mt-1 text-xs leading-relaxed text-rc-muted">
                The job could not list the evidence bucket, so it has copied nothing. This is not an
                empty bucket — check the Vercel logs for &ldquo;could not read the source
                bucket&rdquo;.
              </p>
            ) : backupFailures.length > 0 ? (
              <p className="mt-1 text-xs font-semibold text-rc-red">
                {backupFailures.length} could not be copied — check the Vercel logs for
                &ldquo;storage backup failed&rdquo;.
              </p>
            ) : sourceCount > backedUp.length ? (
              <p className="mt-1 text-xs font-semibold text-rc-red">
                {sourceCount - backedUp.length} not yet copied. The job runs hourly; if this number
                doesn&rsquo;t fall, it has stopped.
              </p>
            ) : sourceCount === 0 ? (
              <p className="mt-1 text-xs text-rc-muted">
                Nothing uploaded yet, so there is nothing to back up. This will read 0 of 0 until an
                agency uploads its first document.
              </p>
            ) : (
              <p className="mt-1 text-xs text-rc-muted">
                Runs hourly. Every document is copied. A date older than today means the job has
                stopped.
              </p>
            )}
          </>
        )}
      </div>

      {/* AGENCIES, oldest first — so Cass stays at the top and each new tester
          appears underneath in the order they arrived, which is the order the
          question is usually asked in. */}
      <h2 id="agencies" className={sectionHeading}>Agencies</h2>
      <div className="mt-3 space-y-3">
        {agencies.map((agency) => {
          const people = peopleIn(agency.id);
          const listings = listingsIn(agency.id);
          return (
            <section key={agency.id} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-rc-ink">{agency.name}</p>
                <p className="text-xs text-rc-muted">
                  Joined {formatAuDate(agency.created_at.slice(0, 10))}
                </p>
              </div>
              <p className="mt-0.5 text-xs text-rc-muted">
                {agency.status === "comped" ? "Free account" : agency.status} · {agency.plan} ·{" "}
                {listings.length === 0 ? (
                  // Named plainly rather than shown as a zero. A tester who has
                  // not added a listing has not tested anything, and that is
                  // the thing worth chasing.
                  <span className="font-semibold text-rc-amber-deep">no listings yet</span>
                ) : (
                  `${listings.length} listing${listings.length === 1 ? "" : "s"}`
                )}
              </p>

              <ul className="mt-3 divide-y divide-rc-border border-t border-rc-border">
                {people.length === 0 && (
                  <li className="py-2 text-xs text-rc-muted">
                    No people — an agency row with nobody in it, which shouldn&rsquo;t happen. Tell me if you
                    see this.
                  </li>
                )}
                {people.map((person) => (
                  <li key={person.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="text-sm text-rc-ink">
                      {person.full_name || "(no name)"}{" "}
                      <span className="text-xs text-rc-muted">{person.email}</span>
                    </span>
                    <span className="text-xs font-medium text-rc-muted">
                      {person.is_platform_admin ? "RealComply staff · " : ""}
                      {person.is_licensee_in_charge ? "Licensee in charge" : "Agent"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      {/* ENDED SUBSCRIPTIONS (8 Oct 2026). Every agency in its 14-day records
          window, the legal hold switch (Data Retention Policy section 6), and
          the deletion log, so a deletion can be seen to have happened. The
          one place on this page that changes another agency: the hold only
          ever stops a deletion, it never causes one. */}
      <h2 id="ended" className={sectionHeading}>Ended subscriptions</h2>
      <p className="mt-1 text-xs text-rc-muted">
        Records are deleted on the date shown, in the daily run. An agency on legal hold is skipped until the hold is
        lifted. Cass Property, Comply Real Estate, comped agencies and your own are never picked up.
      </p>
      <div className="mt-3 space-y-3">
        {ended.length === 0 && <p className="text-xs text-rc-muted">None right now.</p>}
        {ended.map((a) => (
          <section key={a.id} className="rounded-card border border-rc-border bg-white p-4 shadow-card">
            <p className="text-sm font-bold text-rc-ink">{a.name}</p>
            <p className="mt-0.5 text-xs text-rc-muted">
              Ended {longDate(sydneyDate(new Date(a.ended_at)))} · deleted on {longDate(deletionDate(new Date(a.ended_at)))}
              {" · "}day 0 email {a.ended_notice_sent_at ? "sent" : "not sent"} · day 7 email{" "}
              {a.ended_reminder_sent_at ? "sent" : "not sent"}
            </p>
            <LegalHoldForm agencyId={a.id} held={a.legal_hold} reason={a.legal_hold_reason} />
            {/* Testing on a throwaway agency. Never rendered on the live site,
                and the action refuses there too. */}
            {process.env.VERCEL_ENV !== "production" && <DeleteNowForm agencyId={a.id} name={a.name} />}
          </section>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <DryRunButton />
        <SendOwedEmailsButton />
      </div>
      <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-rc-faint">Deletion log</h3>
      <ul className="mt-2 divide-y divide-rc-border rounded-card border border-rc-border bg-white text-xs shadow-card">
        {runs.length === 0 && <li className="p-3 text-rc-muted">No runs yet.</li>}
        {runs.map((r) => (
          <li key={r.id} className="p-3">
            <span className="font-semibold text-rc-ink">
              {r.dry_run ? "Dry run" : "Deletion"}: {r.status}
              {r.step && r.status === "started" ? ` (waiting at ${r.step})` : ""}
            </span>{" "}
            <span className="text-rc-muted">
              {nameFor(r.agency_ref)} · {new Date(r.started_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}
              {r.certificate_number ? ` · certificate ${r.certificate_number}` : ""}
            </span>
            {r.reason && <p className="mt-0.5 text-rc-amber-deep">{r.reason}</p>}
            {r.counts && (
              <p className="mt-0.5 text-rc-muted">
                {Object.entries(r.counts)
                  .map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`)
                  .join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>

      {/* EARLY ACCESS. Above founder invites deliberately: this is the queue
          with work in it, and the invites below are mostly its output. Adam,
          18 Sep 2026 — "so I can either deny or accept anyone that's registered
          for early access." */}
      <h2 id="early-access" className={sectionHeading}>Early access</h2>
      <p className="mt-1 text-xs text-rc-muted">
        Everyone who registered at realcomply.com.au. Send each person their invitation when you&rsquo;re ready.
        Each email is BCC&rsquo;d to admin@realcomply.com.au.
      </p>

      <div className="mt-3">
        <EarlyAccessQueue rows={earlyAccess} />
      </div>

      <div className="mt-3">
        <WelcomeTest />
      </div>

      {/* CPD reminders (brief, 19 Oct 2026): a test email of either version,
          and the real job for a made-up office. Only offices whose people are
          all on Adam's test addresses, archived people included. */}
      <div className="mt-3">
        <CpdReminderTest offices={madeUpOffices} dates={await cpdSendDatesThisYear()} />
      </div>

      {/* PERSONAL INVITES (Founder invites until 12 Oct 2026). Making one lives here rather than in Team settings, which is
          where Adam went looking and where the only invite button puts somebody
          INSIDE this agency — see the note in lib/actions/founder-invites.ts. */}
      <h2 id="personal-invites" className={sectionHeading}>Personal invites</h2>
      <p className="mt-1 text-xs text-rc-muted">
        People you invite yourself. RealComply emails them their own link, the same way early access invitations
        go, BCC&rsquo;d to admin@realcomply.com.au. Each link works once and creates one new agency. Not the same
        as a Team invite, which adds someone to <em>this</em> agency.
      </p>

      <div className="mt-3">
        <FounderInvites invites={personalInvites} siteUrl={siteUrl} />
      </div>

      {/* ANNOUNCEMENTS. One-off emails to named offices, each office once.
          The first: property management is now in your account (Adam,
          22 Oct 2026). */}
      <h2 id="announcements" className={sectionHeading}>Announcements</h2>
      <div className="mt-3">
        <PmAnnouncement rows={pmAnnouncementRows} testAddress={PM_ANNOUNCEMENT_TEST_ADDRESS} />
      </div>
    </main>
  );
}

// Every section heading. The scroll margin keeps a heading clear of the
// sticky jump bar when one of its buttons is pressed.
const sectionHeading = "mt-9 scroll-mt-[calc(var(--rc-userbar-h,0px)+64px)] text-sm font-bold text-rc-ink";

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-card border border-rc-border bg-white p-3 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-rc-faint">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-rc-ink">{value}</p>
    </div>
  );
}
