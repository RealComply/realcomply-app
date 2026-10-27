import type { SupabaseClient } from "@supabase/supabase-js";
import type { Access } from "@/lib/access";
import type { Profile } from "@/lib/types";
import { currentCpdYear } from "@/lib/cpd-year";
import { isOfficeAgent, myConfirmedVersions, officeAdoption } from "@/lib/sg-annexure/office-read";
import {
  officeSetupSteps,
  setupSummary,
  staffSetupSteps,
  type SetupAgency,
  type SetupMark,
  type SetupPerson,
  type SetupStep,
} from "@/lib/rules/office-setup";

// What Home shows for "Set up your office" (Adam, 27 Oct 2026). The rules
// are in lib/rules/office-setup.ts; this reads what they need, with the
// reader's own access. The licensee in charge, an office manager and the
// agent on their own plan read their whole office (runs_office(), 0093);
// everyone else reads their own rows.
//
// Before 0099 has run there are no marks, so nothing can be marked "Doesn't
// apply" and the done moment isn't kept; the card still works.

export type SetupView = {
  /** The card, or the small line once it's all done. */
  mode: "card" | "done";
  /** "Set up your office" or "Set up your profile". */
  title: string;
  /** "Office set up" or "Profile set up", for the small line. */
  doneLabel: string;
  /** The office list is grouped and behind "See every step"; a person's own list shows under the next step. */
  grouped: boolean;
  steps: SetupStep[];
  done: number;
  total: number;
  next: SetupStep | null;
};

const PERSON_COLUMNS =
  "id, full_name, email, is_agent, is_assistant, is_licensee_in_charge, licence_type, licence_document_path, licence_expiry, licence_categories, archived_at";

/** Null when there is nothing to show this person. */
export async function setupViewFor(supabase: SupabaseClient, profile: Profile, access: Access): Promise<SetupView | null> {
  try {
    if (access.runsOffice) return await officeView(supabase, profile, access);
    return await staffView(supabase, profile, access);
  } catch (err) {
    // Never at the cost of Home.
    console.error("set up your office: couldn't read", err);
    return null;
  }
}

async function officeView(supabase: SupabaseClient, profile: Profile, access: Access): Promise<SetupView | null> {
  const agentPlan = access.isAgentPlan;
  const cpdYear = currentCpdYear();
  const agencyId = profile.agency_id;

  const [
    { data: agencyRow },
    { data: peopleRows, error: peopleError },
    adoption,
    { data: signedRows },
    { count: inviteCount },
    { count: versionCount },
    { data: sgDoc },
    { data: planRows },
    { count: trustCount },
    { data: listingCount },
    { data: markRows },
  ] = await Promise.all([
    supabase.from("agencies").select("*").eq("id", agencyId).maybeSingle(),
    supabase.from("profiles").select(PERSON_COLUMNS).eq("agency_id", agencyId),
    agentPlan ? Promise.resolve(null) : officeAdoption(supabase),
    // On an agent's own plan: the licensee's signed adoption page (0071).
    agentPlan
      ? supabase
          .from("signoff_documents")
          .select("id")
          .eq("agency_id", agencyId)
          .eq("category", "sg_annexure_licensee_signed")
          .limit(1)
      : Promise.resolve({ data: [] }),
    supabase.from("agency_invites").select("id", { count: "exact", head: true }).eq("agency_id", agencyId),
    supabase.from("sg_manual_versions").select("id", { count: "exact", head: true }).eq("agency_id", agencyId),
    // The current SG Manual everyone signs: the newest all-staff version.
    supabase
      .from("signoff_documents")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("category", "sg_manual")
      .eq("signer_scope", "all_staff")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("training_plans").select("profile_id, principal_signed_at").eq("cpd_year_start", cpdYear.start),
    supabase
      .from("trust_accounts")
      .select("id", { count: "exact", head: true })
      .eq("agency_id", agencyId)
      .is("archived_at", null),
    // The office's count, which an office manager can't read from properties (0099).
    supabase.rpc("office_setup_listing_count"),
    supabase.from("office_setup_marks").select("step, marked_by, marked_at"),
  ]);
  if (!agencyRow || peopleError) return null;

  const people = (peopleRows ?? []) as SetupPerson[];
  const marks = (markRows ?? []) as SetupMark[];
  const docId = (sgDoc as { id: string } | null)?.id ?? null;
  const { data: sigRows } = docId
    ? await supabase.from("signoff_signatures").select("signer_id, signed_at").eq("document_id", docId)
    : { data: null };

  const agency = agencyRow as SetupAgency & { name: string };
  const names = new Map(people.map((p) => [p.id, p.full_name?.trim() || p.email || "Someone"]));
  const licensee = people.find((p) => p.is_licensee_in_charge === true && !p.archived_at);

  const steps = officeSetupSteps({
    kind: agentPlan ? "agent_plan" : "office",
    viewer: { id: profile.id, isOfficeManager: access.isOfficeManager },
    agency,
    people,
    annexureDone: agentPlan ? ((signedRows ?? []) as unknown[]).length > 0 : adoption !== null,
    teamInvites: inviteCount ?? 0,
    sgManualVersions: versionCount ?? 0,
    sgSigners: docId
      ? ((sigRows ?? []) as Array<{ signer_id: string; signed_at: string | null }>).map((r) => ({
          signerId: r.signer_id,
          signed: Boolean(r.signed_at),
        }))
      : null,
    approvedPlanIds: ((planRows ?? []) as Array<{ profile_id: string; principal_signed_at: string | null }>)
      .filter((r) => r.principal_signed_at)
      .map((r) => r.profile_id),
    trustAccounts: trustCount ?? 0,
    // Before 0099 the function isn't there: what this person can see.
    listings: typeof listingCount === "number" ? listingCount : await visibleListings(supabase),
    marks,
    nameOf: (id) => (id ? names.get(id) ?? "Someone who has left" : "Someone"),
    cpdYearLabel: cpdYear.label,
    licenseeName: licensee?.full_name?.trim() || agency.licensee_name?.trim() || null,
  });
  const sum = setupSummary(steps);
  const recorded = marks.some((m) => m.step === "all_done");

  // The first time it is all done is kept (0099), so the card stays gone.
  if (sum.allDone && !recorded) {
    const { error } = await supabase.rpc("note_office_setup_done");
    if (error) console.error("set up your office: couldn't record done", error.message);
  }

  return {
    mode: recorded || sum.allDone ? "done" : "card",
    title: "Set up your office",
    doneLabel: "Office set up",
    grouped: true,
    steps,
    done: sum.done,
    total: sum.total,
    next: sum.next,
  };
}

async function visibleListings(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase.from("properties").select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function staffView(supabase: SupabaseClient, profile: Profile, access: Access): Promise<SetupView | null> {
  const officeAgent = isOfficeAgent(access);
  const [{ data: me }, adoption, confirmed, { count: versionCount }, { data: myDocs }] = await Promise.all([
    supabase.from("profiles").select(PERSON_COLUMNS).eq("id", profile.id).maybeSingle(),
    officeAgent ? officeAdoption(supabase) : Promise.resolve(null),
    officeAgent ? myConfirmedVersions(supabase, profile.id) : Promise.resolve([] as string[]),
    supabase.from("sg_manual_versions").select("id", { count: "exact", head: true }).eq("agency_id", profile.agency_id),
    // The newest all-staff SG Manual they were asked to sign (they see only those).
    supabase
      .from("signoff_documents")
      .select("id")
      .eq("agency_id", profile.agency_id)
      .eq("category", "sg_manual")
      .eq("signer_scope", "all_staff")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  if (!me || confirmed === null) return null;

  const docId = ((myDocs ?? []) as Array<{ id: string }>)[0]?.id ?? null;
  const { data: mine } = docId
    ? await supabase
        .from("signoff_signatures")
        .select("signed_at")
        .eq("document_id", docId)
        .eq("signer_id", profile.id)
        .maybeSingle()
    : { data: null };

  const steps = staffSetupSteps({
    person: me as SetupPerson,
    officeAgent,
    adoptedVersion: adoption?.version ?? null,
    confirmedVersions: confirmed,
    sgManualExists: (versionCount ?? 0) > 0,
    sgSigned: Boolean((mine as { signed_at: string | null } | null)?.signed_at),
  });
  if (steps.length === 0) return null;
  const sum = setupSummary(steps);
  return {
    mode: sum.allDone ? "done" : "card",
    title: "Set up your profile",
    doneLabel: "Profile set up",
    grouped: false,
    steps,
    done: sum.done,
    total: sum.total,
    next: sum.next,
  };
}
