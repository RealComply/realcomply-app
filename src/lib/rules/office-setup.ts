// "Set up your office" on Home (Adam, 27 Oct 2026; mockup approved, Step 0
// proposals approved the same day). What each step is, and whether it is
// done, from what is already in RealComply. Pure, so every case is tested.
//
// EVERY STEP TICKS ITSELF. Nobody ticks a step by hand. Upload the PI
// certificate and that step is done. The one exception is "Doesn't apply",
// on the steps that may not apply to an office, which records who and when
// (0099) and counts as done.
//
// WHO SEES WHICH LIST.
//   - The licensee in charge and an office manager: the office list.
//   - An agent on their own plan (a contractor under their own ABN): the
//     office-style list for their own account (addendum, Adam 27 Oct 2026).
//   - Everyone else (agents, assistants, property managers in an office, and
//     an assistant on an agent's plan): "Set up your profile", their own
//     steps only.
//
// NEXT STEP is the first step not done, in the order below. A step only the
// licensee can do still comes up for an office manager, saying so, with no
// button.
//
// ONCE DONE the card goes and one small line stays. For an office or an
// agent's own plan, the first time every step is done is recorded (0099), so
// someone joining later (they get their own card) or a lapsed policy (the
// expiry reminders handle that) never brings the card back. A person's own
// card is worked out each time.

import { cleanLicenceCategories } from "@/lib/rules/nsw-cpd";

export type SetupGroupKey = "office" | "licences" | "supervision" | "cpd_trust" | "files";

export const SETUP_GROUPS: Record<SetupGroupKey, string> = {
  office: "Your office",
  licences: "Licences and insurance",
  supervision: "Supervision and training",
  cpd_trust: "CPD and trust",
  files: "Your first files",
};

/** The steps that may be marked "Doesn't apply" (0099). The SG Manual only on an agent's own plan. */
export const NOT_APPLICABLE_STEPS = ["icare", "trust_account", "corporation_licence", "team_invited", "sg_manual"] as const;
export type NotApplicableStep = (typeof NOT_APPLICABLE_STEPS)[number];

export function isNotApplicableStep(value: string): value is NotApplicableStep {
  return (NOT_APPLICABLE_STEPS as readonly string[]).includes(value);
}

export type SetupStep = {
  key: string;
  /** Null on a person's own card, which isn't grouped. */
  group: SetupGroupKey | null;
  title: string;
  /** One short line under the title in the list. */
  line: string;
  /** The line in the Next step box. */
  nextLine: string;
  /** Done, or marked "Doesn't apply". */
  done: boolean;
  /** Marked "Doesn't apply": by whom and when (a timestamp). Counts as done. */
  notApplicable: { byName: string; at: string } | null;
  /** The button that marks it "Doesn't apply", when it may be; null otherwise. */
  notApplicableLabel: string | null;
  /** "N of N people", where the step is about everyone. */
  progress: { done: number; total: number } | null;
  /** Where the button goes. */
  href: string;
  /** The button's words. */
  action: string;
  /** The annexure's "Review and sign", which is a form rather than a link. */
  annexureForm: boolean;
  /** Why the reader can't do this one themselves, or null. Shown instead of a button. */
  waitingOn: string | null;
  /** False for a step that can't be done yet (an agent's read before the office adopts): shown, not counted. */
  counted: boolean;
};

export type SetupPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
  is_agent: boolean | null;
  is_assistant: boolean | null;
  is_licensee_in_charge: boolean | null;
  licence_type: string | null;
  licence_document_path: string | null;
  licence_expiry: string | null;
  licence_categories?: string[] | null;
  archived_at: string | null;
};

export type SetupAgency = {
  name: string | null;
  licensee_name: string | null;
  licensee_email: string | null;
  website_url: string | null;
  logo_path: string | null;
  corporation_licence_number: string | null;
  corporation_licence_expiry: string | null;
  pi_expiry: string | null;
  icare_expiry: string | null;
  pm_enabled?: boolean | null;
  pm_records_system?: string | null;
};

export type SetupMark = { step: string; marked_by: string | null; marked_at: string };

export type OfficeSetupInput = {
  /** An office, or an agent's own plan (the addendum's list). */
  kind: "office" | "agent_plan";
  viewer: { id: string; isOfficeManager: boolean };
  agency: SetupAgency;
  /** Everyone in the office, people who have left included (they are skipped). */
  people: SetupPerson[];
  /** Office: the annexure adopted. Agent's own plan: the licensee's signed adoption page uploaded. */
  annexureDone: boolean;
  /** Team invites ever sent. */
  teamInvites: number;
  sgManualVersions: number;
  /** Who was asked to sign the current SG Manual and whether they have; null when there is none. */
  sgSigners: Array<{ signerId: string; signed: boolean }> | null;
  /** People with a training plan for the current CPD year approved by the licensee. */
  approvedPlanIds: string[];
  /** Trust accounts not archived. */
  trustAccounts: number;
  listings: number;
  marks: SetupMark[];
  /** Names for the marks' marked_by. */
  nameOf: (id: string | null) => string;
  /** "2026–27". */
  cpdYearLabel: string;
  /** For "Only … can do this"; the Office profile name if there is no login. */
  licenseeName: string | null;
};

const REGISTERS_LICENCES = "/dashboard/registers?tab=licence";
const REGISTERS_INSURANCE = "/dashboard/registers?tab=insurance";

const present = (people: SetupPerson[]) => people.filter((p) => !p.archived_at);
const filled = (v: string | null | undefined) => typeof v === "string" && v.trim().length > 0;

/** Who CPD applies to: the same people the CPD reminders count (lib/cpd-reminders.ts). */
export function needsCpdForSetup(p: SetupPerson): boolean {
  if (p.archived_at) return false;
  return p.licence_type !== null || p.is_agent === true || p.is_licensee_in_charge === true;
}

/** Whose licence or certificate is asked for: everyone but an assistant with no licence type on file (proposal D). */
export function holdsLicence(p: SetupPerson): boolean {
  if (p.archived_at) return false;
  return p.licence_type !== null || p.is_assistant !== true;
}

const hasLicenceTypes = (p: SetupPerson) => cleanLicenceCategories(p.licence_categories).length > 0;
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const ofPeople = (done: number, total: number) => `${done} of ${total} ${total === 1 ? "person" : "people"}`;

function base(
  partial: Pick<SetupStep, "key" | "group" | "title" | "line" | "nextLine" | "done" | "href" | "action"> & Partial<SetupStep>,
): SetupStep {
  return {
    notApplicable: null,
    notApplicableLabel: null,
    progress: null,
    annexureForm: false,
    waitingOn: null,
    counted: true,
    ...partial,
  };
}

/** A step that may be "Doesn't apply": done when marked, with who and when. */
function withNotApplicable(step: SetupStep, key: NotApplicableStep, input: OfficeSetupInput, label = "Doesn't apply"): SetupStep {
  const mark = input.marks.find((m) => m.step === key);
  if (mark) {
    return {
      ...step,
      done: true,
      notApplicable: { byName: input.nameOf(mark.marked_by), at: mark.marked_at },
      notApplicableLabel: label,
    };
  }
  return { ...step, notApplicableLabel: step.done ? null : label };
}

function expiresLine(expiry: string | null, fallback: string): string {
  return expiry ? `On file, expires ${formatDay(expiry)}` : fallback;
}

/** "2028-03-14" → "14 Mar 2028". Short months for a one-line detail. */
export function formatDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** The office list, or an agent's own plan's (the addendum). */
export function officeSetupSteps(input: OfficeSetupInput): SetupStep[] {
  const agentPlan = input.kind === "agent_plan";
  const om = !agentPlan && input.viewer.isOfficeManager;
  const onlyLicensee = (what: string) => `Only ${input.licenseeName?.trim() || "the licensee in charge"} can ${what}.`;
  const here = present(input.people);
  const steps: SetupStep[] = [];

  // ── Your office ─────────────────────────────────────────────────────────
  const a = input.agency;
  const missing: Array<{ label: string; licenseeOnly: boolean }> = [];
  if (!filled(a.name)) missing.push({ label: "trading name", licenseeOnly: false });
  if (!filled(a.licensee_name)) missing.push({ label: "licensee's name", licenseeOnly: true });
  if (!filled(a.licensee_email)) missing.push({ label: "licensee's email", licenseeOnly: true });
  if (!filled(a.website_url)) missing.push({ label: "website", licenseeOnly: true });
  if (!filled(a.logo_path)) missing.push({ label: "logo", licenseeOnly: false });
  steps.push(
    base({
      key: "office_profile",
      group: "office",
      title: "Office profile complete",
      line: missing.length === 0 ? "Names, licensee details, website and logo" : `Still to add: ${missing.map((m) => m.label).join(", ")}`,
      nextLine:
        missing.length === 0
          ? "Profile settings."
          : `Profile settings · still to add: ${missing.map((m) => m.label).join(", ")}.`,
      done: missing.length === 0,
      href: "/dashboard/profile",
      action: "Open",
      // An office manager can't change the licensee's own details (0093, 0095).
      waitingOn: om && missing.length > 0 && missing.every((m) => m.licenseeOnly) ? onlyLicensee("add these") : null,
    }),
  );

  if (agentPlan) {
    steps.push(
      base({
        key: "annexure",
        group: "office",
        title: "Annexure adopted",
        line: input.annexureDone ? "Your licensee's signed adoption page is on file" : "Your licensee signs the adoption page; you upload it",
        nextLine: "Getting started · download the annexure for your licensee, then upload the signed adoption page.",
        done: input.annexureDone,
        href: "/dashboard/getting-started",
        action: "Upload",
      }),
    );
  } else {
    steps.push(
      base({
        key: "annexure",
        group: "office",
        title: "Supervision Guidelines annexure adopted",
        line: input.annexureDone ? "Signed by the licensee in charge" : "The licensee in charge signs it",
        nextLine: "About two minutes. You stay in charge of your agency's compliance.",
        done: input.annexureDone,
        href: "/dashboard/home",
        action: "Review and sign",
        annexureForm: true,
        waitingOn: om ? onlyLicensee("adopt the annexure") : null,
      }),
    );
    const others = here.length - 1;
    const teamDone = input.teamInvites > 0 || others > 0;
    steps.push(
      withNotApplicable(
        base({
          key: "team_invited",
          group: "office",
          title: "Team invited",
          line: others > 0 ? people(here.length) : teamDone ? "Invites sent" : "The people who work in your office",
          nextLine: "Team · invite the people who work in your office.",
          done: teamDone,
          href: "/dashboard/team",
          action: "Invite",
        }),
        "team_invited",
        input,
        "Doesn't apply (just me)",
      ),
    );
  }

  // ── Licences and insurance ──────────────────────────────────────────────
  const corporation = withNotApplicable(
    base({
      key: "corporation_licence",
      group: "licences",
      title: "Corporation licence",
      line:
        filled(a.corporation_licence_number) && a.corporation_licence_expiry
          ? expiresLine(a.corporation_licence_expiry, "")
          : agentPlan
            ? "If you trade through a company"
            : "Not needed by a sole trader",
      nextLine: "Registers · RealComply reads the number and expiry date for you.",
      done: filled(a.corporation_licence_number) && Boolean(a.corporation_licence_expiry),
      href: REGISTERS_LICENCES,
      action: "Upload",
    }),
    "corporation_licence",
    input,
  );

  const licenceStep = (who: SetupPerson, key: string, title: string): SetupStep =>
    base({
      key,
      group: "licences",
      title,
      line: who.licence_document_path ? expiresLine(who.licence_expiry, "On file") : "Upload it and RealComply reads the number and expiry date",
      nextLine: "Registers · RealComply reads the number and expiry date for you.",
      done: Boolean(who.licence_document_path),
      href: REGISTERS_LICENCES,
      action: "Upload",
    });

  const pi = base({
    key: "pi",
    group: "licences",
    title: "Professional indemnity insurance",
    line: a.pi_expiry
      ? expiresLine(a.pi_expiry, "")
      : agentPlan
        ? "Your own policy, or a certificate showing the agency's policy covers you"
        : "Required for every licence",
    nextLine: "Registers · about 1 minute. RealComply reads the expiry date for you.",
    done: Boolean(a.pi_expiry),
    href: REGISTERS_INSURANCE,
    action: "Upload",
  });

  const icare = withNotApplicable(
    base({
      key: "icare",
      group: "licences",
      title: "Workers compensation (iCare)",
      line: a.icare_expiry ? expiresLine(a.icare_expiry, "") : "If you employ staff",
      nextLine: "Registers · upload the certificate, or mark it Doesn't apply.",
      done: Boolean(a.icare_expiry),
      href: REGISTERS_INSURANCE,
      action: "Upload",
    }),
    "icare",
    input,
  );

  if (agentPlan) {
    const me = here.find((p) => p.id === input.viewer.id);
    if (me) steps.push(licenceStep(me, "own_licence", "Your licence"));
    steps.push(pi, corporation, icare);
  } else {
    steps.push(corporation);
    // Left out when the licensee isn't on RealComply: there is nowhere to put it (proposal C).
    const licensee = here.find((p) => p.is_licensee_in_charge === true);
    if (licensee) steps.push(licenceStep(licensee, "licensee_licence", "Licensee's own licence"));
    steps.push(pi, icare);

    const team = here.filter((p) => p.is_licensee_in_charge !== true && holdsLicence(p));
    const teamOnFile = team.filter((p) => p.licence_document_path).length;
    const teamStepDone = steps.find((s) => s.key === "team_invited")?.done === true;
    steps.push(
      base({
        key: "team_licences",
        group: "licences",
        title: "Team licences and certificates",
        line: team.length === 0 ? "No one else has joined yet" : `${ofPeople(teamOnFile, team.length)} done`,
        nextLine: "Registers · each person's licence or certificate of registration.",
        // With no one else yet, done once the team step is (invited, or just me).
        done: team.length === 0 ? teamStepDone : teamOnFile === team.length,
        progress: team.length === 0 ? null : { done: teamOnFile, total: team.length },
        href: REGISTERS_LICENCES,
        action: "Open",
      }),
    );
  }

  // ── Supervision and training ────────────────────────────────────────────
  const sgManual = base({
    key: "sg_manual",
    group: "supervision",
    title: "SG Manual uploaded",
    line:
      input.sgManualVersions > 0
        ? "On file"
        : agentPlan
          ? "Your own, or Doesn't apply if you work under your agency's"
          : "Your office's supervision procedures",
    nextLine: "SG Manual · upload your Supervision Guidelines Manual.",
    done: input.sgManualVersions > 0,
    href: "/dashboard/sg-manual",
    action: "Upload",
  });
  steps.push(agentPlan ? withNotApplicable(sgManual, "sg_manual", input) : sgManual);

  if (agentPlan) {
    steps.push(
      base({
        key: "own_training_plan",
        group: "supervision",
        title: `Training plan for ${input.cpdYearLabel}`,
        line: "Your plan for the CPD year, signed off",
        nextLine: "Training · set out your plan for the CPD year.",
        done: input.approvedPlanIds.includes(input.viewer.id),
        href: "/dashboard/training",
        action: "Start",
      }),
    );
  } else {
    const signers = input.sgSigners;
    const signedIds = new Set((signers ?? []).filter((s) => s.signed).map((s) => s.signerId));
    const signedHere = here.filter((p) => signedIds.has(p.id)).length;
    steps.push(
      base({
        key: "sg_signed",
        group: "supervision",
        title: "Staff have signed the SG Manual",
        line: signers === null ? "Upload the SG Manual first" : ofPeople(signedHere, here.length),
        nextLine: "SG Manual · everyone in the office signs the current version.",
        done: signers !== null && signedHere === here.length,
        progress: { done: signers === null ? 0 : signedHere, total: here.length },
        href: "/dashboard/sg-manual",
        action: "Open",
      }),
    );
    const planned = here.filter((p) => input.approvedPlanIds.includes(p.id)).length;
    steps.push(
      base({
        key: "training_plans",
        group: "supervision",
        title: `Training plan for ${input.cpdYearLabel}`,
        line: `${ofPeople(planned, here.length)} approved by the licensee`,
        nextLine: "Training · one plan per person for the CPD year, approved by the licensee.",
        done: planned === here.length,
        progress: { done: planned, total: here.length },
        href: "/dashboard/training",
        action: "Start",
      }),
    );
  }

  // ── CPD and trust ───────────────────────────────────────────────────────
  if (agentPlan) {
    const me = here.find((p) => p.id === input.viewer.id);
    steps.push(
      base({
        key: "licence_types",
        group: "cpd_trust",
        title: "Licence types set for CPD",
        line: "So you see the right CPD for the year",
        nextLine: "Registers · tick the licence types you hold.",
        done: me ? hasLicenceTypes(me) : false,
        href: REGISTERS_LICENCES,
        action: "Open",
      }),
    );
  } else {
    const cpd = here.filter(needsCpdForSetup);
    const set = cpd.filter(hasLicenceTypes).length;
    steps.push(
      base({
        key: "licence_types",
        group: "cpd_trust",
        title: "Everyone's licence types set for CPD",
        line: cpd.length === 0 ? "So each person sees the right CPD for the year" : `${ofPeople(set, cpd.length)} done`,
        nextLine: "Registers · tick each person's licence types, so they see the right CPD.",
        done: set === cpd.length,
        progress: cpd.length === 0 ? null : { done: set, total: cpd.length },
        href: REGISTERS_LICENCES,
        action: "Open",
      }),
    );
  }
  steps.push(
    withNotApplicable(
      base({
        key: "trust_account",
        group: "cpd_trust",
        title: agentPlan ? "Trust account" : "Trust account added",
        line: input.trustAccounts > 0 ? "On file" : "If your office holds trust money",
        nextLine: "Trust accounts · add the account, or mark it Doesn't apply.",
        done: input.trustAccounts > 0,
        href: "/dashboard/trust",
        action: "Add",
      }),
      "trust_account",
      input,
      agentPlan ? "My deposits go into the agency's trust account" : "Doesn't apply",
    ),
  );

  // ── Your first files ────────────────────────────────────────────────────
  steps.push(
    base({
      key: "first_listing",
      group: "files",
      title: "First listing added",
      line: input.listings > 0 ? `${input.listings} ${input.listings === 1 ? "listing" : "listings"}` : "Add your first sales listing",
      nextLine: "Add a listing · RealComply reads your documents and tracks each stage.",
      done: input.listings > 0,
      href: "/dashboard/new",
      action: "Add a listing",
    }),
  );
  if (!agentPlan && a.pm_enabled === true) {
    steps.push(
      base({
        key: "pm_records",
        group: "files",
        title: "Where your PM records are kept",
        line: filled(a.pm_records_system) ? (a.pm_records_system as string).trim() : "The system your property management records are in",
        nextLine: "Property management · say where your PM records are kept.",
        done: filled(a.pm_records_system),
        href: "/dashboard/pm",
        action: "Open",
      }),
    );
  }

  return steps;
}

export type StaffSetupInput = {
  person: SetupPerson;
  /** An agent in an office (not the licensee, an assistant or an agent on their own plan). */
  officeAgent: boolean;
  /** The annexure version the office adopted, or null. */
  adoptedVersion: string | null;
  confirmedVersions: string[];
  /** The office has an SG Manual. */
  sgManualExists: boolean;
  /** They have signed the current SG Manual. */
  sgSigned: boolean;
};

/** "Set up your profile": a person's own steps. */
export function staffSetupSteps(input: StaffSetupInput): SetupStep[] {
  const p = input.person;
  const steps: SetupStep[] = [];
  if (input.officeAgent && p.is_assistant !== true) {
    const adopted = input.adoptedVersion;
    steps.push(
      base({
        key: "sg_read",
        group: null,
        title: "Read the annexure and Supervision Guidelines",
        line: adopted ? "Read both, then tick to confirm" : "Waiting for your licensee to adopt the annexure",
        nextLine: "Read both, then tick to confirm on the card below.",
        done: adopted !== null && input.confirmedVersions.includes(adopted),
        // The tick is on the Home card (SgReadCard), so the button goes there.
        href: "/dashboard/home#sg-read",
        action: "Read",
        waitingOn: adopted ? null : "Waiting for your licensee to adopt the annexure.",
        counted: adopted !== null,
      }),
    );
  }
  if (needsCpdForSetup(p)) {
    steps.push(
      base({
        key: "my_licence_types",
        group: null,
        title: "Licence types set for CPD",
        line: "So you see the right CPD for the year",
        nextLine: "Registers · tick the licence types you hold.",
        done: hasLicenceTypes(p),
        href: REGISTERS_LICENCES,
        action: "Open",
      }),
    );
  }
  if (holdsLicence(p)) {
    steps.push(
      base({
        key: "my_licence",
        group: null,
        title: "Your licence or certificate",
        line: p.licence_document_path ? expiresLine(p.licence_expiry, "On file") : "Upload it and RealComply reads the number and expiry date",
        nextLine: "RealComply reads the number and expiry date for you.",
        done: Boolean(p.licence_document_path),
        href: REGISTERS_LICENCES,
        action: "Upload",
      }),
    );
  }
  if (input.sgManualExists) {
    steps.push(
      base({
        key: "my_sg_signed",
        group: null,
        title: "Sign the SG Manual",
        line: "Your office's Supervision Guidelines Manual",
        nextLine: "Document sign-offs · read it and sign.",
        done: input.sgSigned,
        href: "/dashboard/document-signoffs",
        action: "Open",
      }),
    );
  }
  return steps;
}

export type SetupSummary = {
  done: number;
  total: number;
  /** The first counted step not done, in order. */
  next: SetupStep | null;
  allDone: boolean;
};

export function setupSummary(steps: SetupStep[]): SetupSummary {
  const counted = steps.filter((s) => s.counted);
  const done = counted.filter((s) => s.done).length;
  return {
    done,
    total: counted.length,
    next: counted.find((s) => !s.done) ?? null,
    allDone: counted.length > 0 && done === counted.length,
  };
}

/** Per group, for the headers in the full list: "3 of 3". */
export function groupCounts(steps: SetupStep[]): Array<{ group: SetupGroupKey; label: string; done: number; total: number; steps: SetupStep[] }> {
  const order: SetupGroupKey[] = ["office", "licences", "supervision", "cpd_trust", "files"];
  return order
    .map((group) => {
      const inGroup = steps.filter((s) => s.group === group);
      const counted = inGroup.filter((s) => s.counted);
      return { group, label: SETUP_GROUPS[group], done: counted.filter((s) => s.done).length, total: counted.length, steps: inGroup };
    })
    .filter((g) => g.steps.length > 0);
}
