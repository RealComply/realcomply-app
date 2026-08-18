"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, CircleAlert, Trash2 } from "lucide-react";
import {
  addTrainingPlanItem,
  completeTrainingPlanItem,
  createTrainingPlan,
  deleteTrainingPlanItem,
  reopenTrainingPlan,
  saveTrainingPlanConsultation,
  signTrainingPlan,
  updateCpdPracticeCategory,
  type ActionState,
} from "@/lib/actions/training-plans";
import { CPD_PRACTICE_CATEGORY_LABELS, type CpdRequirement } from "@/lib/rules/nsw-cpd";
import type { CpdRecord, Profile, TrainingPlan, TrainingPlanItem } from "@/lib/types";

const initial: ActionState = { error: null };

const DELIVERY_LABELS: Record<string, string> = {
  face_to_face: "Face-to-face",
  interactive_webinar: "Live interactive webinar",
  online_unit: "Online unit",
  other: "Other",
};

export function TrainingPlanCard({
  subject,
  viewerProfile,
  plan,
  items,
  cpdRecords,
  requirement,
  cpdYearLabel,
}: {
  subject: Profile;
  viewerProfile: Profile;
  plan: TrainingPlan | null;
  items: TrainingPlanItem[];
  cpdRecords: CpdRecord[];
  requirement: CpdRequirement;
  cpdYearLabel: string;
}) {
  const isSelf = viewerProfile.id === subject.id;
  const isLicensee = Boolean(viewerProfile.is_licensee_in_charge);
  const canEdit = isSelf || isLicensee;
  const approved = Boolean(plan?.principal_signed_at);

  const [open, setOpen] = useState(false);
  const [addingItem, setAddingItem] = useState(false);

  const [createState, createAction, creating] = useActionState(createTrainingPlan.bind(null, subject.id), initial);
  const [catState, catAction, catPending] = useActionState(updateCpdPracticeCategory.bind(null, subject.id), initial);

  // What has actually landed in the CPD register this year, which is the
  // number that matters at the end of it — the plan says what should happen,
  // this says what did.
  const isAssistant = subject.licence_type === "certificate_of_registration";
  const logged = cpdRecords.reduce((sum, r) => sum + Number(r.hours), 0);
  const target = requirement.units ?? requirement.coreHours;

  return (
    <div className="rounded-card border border-rc-border bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-rc-ink">{subject.full_name ?? subject.email}</h3>
            {subject.is_licensee_in_charge && (
              <span className="rounded-full bg-rc-green/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rc-green-deep">
                Licensee
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-rc-muted">
            {target === null ? (
              <>Requirement not established for {cpdYearLabel}</>
            ) : (
              <>
                {logged}/{target} {isAssistant ? "units" : "hrs"} logged this year
              </>
            )}
          </p>
        </div>
        <StatusPill plan={plan} />
      </div>

      {/* The requirement, and honestly where it isn't known. */}
      {requirement.unpublished.length > 0 && (
        <div className="mt-3 rounded-md border border-rc-amber/40 bg-rc-amber/10 px-3 py-2 text-[11px] leading-relaxed text-rc-amber-deep">
          {requirement.unpublished.map((u, i) => (
            <p key={i} className={i > 0 ? "mt-1" : undefined}>
              <CircleAlert size={11} className="mr-1 inline align-[-1px]" />
              {u}
            </p>
          ))}
        </div>
      )}

      {/* Category of practice — the thing the hours actually depend on. */}
      {canEdit && !subject.cpd_practice_category && subject.licence_type !== "certificate_of_registration" && (
        <form action={catAction} className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
          <span className="text-xs text-rc-muted">Category of practice:</span>
          <select name="cpdPracticeCategory" className="rounded-md border border-rc-border px-2 py-1 text-xs" defaultValue="">
            <option value="">Choose…</option>
            {Object.entries(CPD_PRACTICE_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={catPending}
            className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
          {catState.error && <span className="text-xs text-rc-amber-deep">{catState.error}</span>}
        </form>
      )}
      {subject.cpd_practice_category && (
        <p className="mt-2 text-[11px] text-rc-faint">
          Category: {CPD_PRACTICE_CATEGORY_LABELS[subject.cpd_practice_category]}
        </p>
      )}

      {!plan ? (
        <form action={createAction} className="mt-3">
          <button
            type="submit"
            disabled={!canEdit || creating}
            className="rounded-full bg-rc-green-deep px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {creating ? "Starting…" : `Start ${cpdYearLabel} plan`}
          </button>
          {createState.error && <p className="mt-1 text-xs text-rc-amber-deep">{createState.error}</p>}
          {!canEdit && <p className="mt-1 text-[11px] text-rc-faint">Only the licensee in charge can start this.</p>}
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 text-xs font-medium text-rc-green-deep hover:underline"
          >
            {open ? "Hide plan" : `Open plan — ${items.filter((i) => i.completed_date).length}/${items.length} complete`}
          </button>

          {open && (
            <div className="mt-3 space-y-4 border-t border-rc-border pt-3">
              <Consultation plan={plan} canEdit={canEdit && !approved} />

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-rc-muted">Training programs</p>
                  {canEdit && !approved && (
                    <button
                      type="button"
                      onClick={() => setAddingItem((v) => !v)}
                      className="text-xs font-medium text-rc-green-deep hover:underline"
                    >
                      {addingItem ? "Cancel" : "+ Add training"}
                    </button>
                  )}
                </div>

                {items.length === 0 ? (
                  <p className="mt-2 text-xs text-rc-faint">Nothing planned yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {items.map((item) => (
                      <PlanItemRow key={item.id} item={item} canEdit={canEdit} locked={approved} />
                    ))}
                  </ul>
                )}

                {addingItem && <AddItemForm planId={plan.id} onDone={() => setAddingItem(false)} />}
              </div>

              <SignOff plan={plan} isSelf={isSelf} isLicensee={isLicensee} itemCount={items.length} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({ plan }: { plan: TrainingPlan | null }) {
  if (!plan) {
    return <span className="shrink-0 rounded-full bg-rc-amber/20 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep">No plan</span>;
  }
  if (plan.principal_signed_at) {
    return <span className="shrink-0 rounded-full bg-rc-green/15 px-2.5 py-0.5 text-xs font-medium text-rc-green-deep">Approved</span>;
  }
  if (plan.staff_signed_at) {
    return <span className="shrink-0 rounded-full bg-rc-amber/20 px-2.5 py-0.5 text-xs font-medium text-rc-amber-deep">Awaiting licensee</span>;
  }
  return <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500">Draft</span>;
}

function Consultation({ plan, canEdit }: { plan: TrainingPlan; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveTrainingPlanConsultation.bind(null, plan.id), initial);
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="rounded-md bg-neutral-50 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 text-xs text-neutral-600">
            <p className="font-medium text-rc-ink">Consultation</p>
            {plan.identified_gaps ? (
              <>
                <p className="mt-1 whitespace-pre-wrap">{plan.identified_gaps}</p>
                {plan.consultation_date && <p className="mt-1 text-rc-faint">Discussed {plan.consultation_date}</p>}
              </>
            ) : (
              <p className="mt-1 text-rc-faint">
                Not recorded yet. This is the gaps you identified together — the reason the plan says what it says.
              </p>
            )}
          </div>
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className="shrink-0 text-xs font-medium text-rc-green-deep hover:underline">
              Edit
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      action={async (fd) => {
        await action(fd);
        setEditing(false);
      }}
      className="space-y-2 rounded-md bg-neutral-50 px-3 py-2"
    >
      <label className="block text-xs text-rc-muted">
        Date you met
        <input
          type="date"
          name="consultationDate"
          defaultValue={plan.consultation_date ?? ""}
          className="mt-1 block rounded-md border border-rc-border px-2 py-1 text-sm"
        />
      </label>
      <textarea
        name="identifiedGaps"
        rows={4}
        defaultValue={plan.identified_gaps ?? ""}
        placeholder="Licence held and when, CPD covered recently, legislative changes since, work reviewed, gaps they raised themselves, where they're heading (upgrading class, auctioneering)…"
        className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-rc-border px-3 py-1 text-xs font-medium text-rc-muted hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}

function PlanItemRow({ item, canEdit, locked }: { item: TrainingPlanItem; canEdit: boolean; locked: boolean }) {
  const [state, action, pending] = useActionState(completeTrainingPlanItem.bind(null, item.id), initial);
  const [completing, setCompleting] = useState(false);
  const done = Boolean(item.completed_date);

  return (
    <li className="rounded-md border border-rc-border px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-xs">
          <p className="font-medium text-rc-ink">
            {done && <CheckCircle2 size={12} className="mr-1 inline align-[-1px] text-rc-green-deep" />}
            {item.program_name}
          </p>
          <p className="mt-0.5 text-neutral-600">
            {item.counts_toward_cpd ? "CPD" : "Office training"}
            {item.delivery_type && <> · {DELIVERY_LABELS[item.delivery_type] ?? item.delivery_type}</>}
            {item.training_hours !== null && <> · {item.training_hours} hrs</>}
            {item.provider && <> · {item.provider}</>}
            {!item.counts_toward_cpd && <span className="text-rc-faint"> · doesn&rsquo;t count toward CPD</span>}
          </p>
          {item.gap_reason && <p className="mt-1 text-rc-muted">Gap: {item.gap_reason}</p>}
          <p className="mt-0.5 text-rc-faint">
            {done ? `Completed ${item.completed_date}` : item.due_date ? `Due ${item.due_date}` : "No due date"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && !done && (
            <button type="button" onClick={() => setCompleting((v) => !v)} className="text-xs font-medium text-rc-green-deep hover:underline">
              {completing ? "Cancel" : "Mark done"}
            </button>
          )}
          {canEdit && !done && !locked && (
            <button
              type="button"
              onClick={() => deleteTrainingPlanItem(item.id)}
              aria-label="Remove"
              className="text-rc-faint transition hover:text-rc-amber-deep"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {completing && (
        <form
          action={async (fd) => {
            await action(fd);
            setCompleting(false);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <input type="date" name="completedDate" required className="rounded-md border border-rc-border px-2 py-1 text-xs" />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            Save
          </button>
          <span className="text-[11px] text-rc-faint">
            {item.counts_toward_cpd ? "Also logs it to the CPD register." : "Office training — won't add CPD hours."}
          </span>
        </form>
      )}
      {state.error && <p className="mt-1 text-xs text-rc-amber-deep">{state.error}</p>}
    </li>
  );
}

function AddItemForm({ planId, onDone }: { planId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState(addTrainingPlanItem.bind(null, planId), initial);

  return (
    <form
      action={async (fd) => {
        await action(fd);
        onDone();
      }}
      className="mt-2 space-y-2 rounded-md border border-rc-border p-2"
    >
      <input
        type="text"
        name="programName"
        placeholder="Training program name"
        className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
      />
      <textarea
        name="gapReason"
        rows={2}
        placeholder="Gap this addresses — why it's on the plan (required)"
        className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap gap-2">
        <select name="classification" className="rounded-md border border-rc-border px-2 py-1 text-sm" defaultValue="compulsory">
          <option value="compulsory">Compulsory</option>
          <option value="elective">Elective</option>
        </select>
        <select name="deliveryType" className="rounded-md border border-rc-border px-2 py-1 text-sm" defaultValue="">
          <option value="">Delivery…</option>
          <option value="face_to_face">Face-to-face</option>
          <option value="interactive_webinar">Live interactive webinar</option>
          <option value="online_unit">Online unit</option>
          <option value="other">Other</option>
        </select>
        <input
          type="number"
          step="0.5"
          min="0"
          name="trainingHours"
          placeholder="Hours"
          className="w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <input type="text" name="provider" placeholder="Provider" className="w-36 rounded-md border border-rc-border px-2 py-1 text-sm" />
        <input type="date" name="dueDate" className="rounded-md border border-rc-border px-2 py-1 text-sm" />
      </div>
      {/* Off by default. Internal coaching belongs on the plan — Requirement
          2.4 is broader than CPD — but it must never accrue CPD hours. */}
      <label className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rc-muted">
        <input type="checkbox" name="countsTowardCpd" className="mt-0.5" />
        <span>
          Counts toward CPD — only if a Fair Trading approved provider delivers it (an RTO statement of attainment for
          an assistant agent). Internal training goes on the plan but earns no CPD hours.
        </span>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        Add
      </button>
      {state.error && <p className="text-xs text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}

function SignOff({
  plan,
  isSelf,
  isLicensee,
  itemCount,
}: {
  plan: TrainingPlan;
  isSelf: boolean;
  isLicensee: boolean;
  itemCount: number;
}) {
  const [staffState, staffAction, staffPending] = useActionState(signTrainingPlan.bind(null, plan.id, "staff"), initial);
  const [principalState, principalAction, principalPending] = useActionState(
    signTrainingPlan.bind(null, plan.id, "principal"),
    initial,
  );

  return (
    <div className="rounded-md bg-neutral-50 px-3 py-2">
      <p className="text-xs font-medium text-rc-ink">Sign-off</p>

      <div className="mt-2 space-y-2 text-xs">
        {/* Staff acceptance */}
        {plan.staff_signed_at ? (
          <p className="text-neutral-600">
            <CheckCircle2 size={12} className="mr-1 inline align-[-1px] text-rc-green-deep" />
            Accepted by {plan.staff_signed_name} on {plan.staff_signed_at.slice(0, 10)}
          </p>
        ) : isSelf ? (
          <form action={staffAction} className="space-y-1">
            <p className="text-neutral-600">
              Accepting confirms this plan was developed with you and sets out the training you&rsquo;ll complete by the
              dates above.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="typedName"
                placeholder="Type your name to accept"
                className="w-56 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={staffPending || itemCount === 0}
                className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Accept
              </button>
            </div>
            {itemCount === 0 && <p className="text-[11px] text-rc-faint">Add at least one training program first.</p>}
            {staffState.error && <p className="text-rc-amber-deep">{staffState.error}</p>}
          </form>
        ) : (
          <p className="text-rc-faint">Waiting for the staff member to accept.</p>
        )}

        {/* Principal approval */}
        {plan.principal_signed_at ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-neutral-600">
              <CheckCircle2 size={12} className="mr-1 inline align-[-1px] text-rc-green-deep" />
              Approved by {plan.principal_signed_name} on {plan.principal_signed_at.slice(0, 10)}
            </p>
            {isLicensee && (
              <button type="button" onClick={() => reopenTrainingPlan(plan.id)} className="shrink-0 text-xs font-medium text-rc-muted hover:underline">
                Reopen to revise
              </button>
            )}
          </div>
        ) : isLicensee ? (
          <form action={principalAction} className="space-y-1 border-t border-rc-border pt-2">
            <p className="text-neutral-600">
              Approving commits the agency to providing the time for this training.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                name="typedName"
                placeholder="Type your name to approve"
                className="w-56 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={principalPending || !plan.staff_signed_at}
                className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                Approve
              </button>
            </div>
            {principalState.error && <p className="text-rc-amber-deep">{principalState.error}</p>}
          </form>
        ) : (
          <p className="text-rc-faint">Waiting for the licensee in charge to approve.</p>
        )}
      </div>
    </div>
  );
}
