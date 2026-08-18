"use client";

import { useActionState, useState } from "react";
import { CircleAlert, Trash2 } from "lucide-react";
import { addCpdRecord, deleteCpdRecord, type ActionState } from "@/lib/actions/registers";
import { updateCpdPracticeCategory } from "@/lib/actions/training-plans";
import { CPD_PRACTICE_CATEGORY_LABELS, type CpdRequirement } from "@/lib/rules/nsw-cpd";
import type { CpdRecord, Profile } from "@/lib/types";

const initial: ActionState = { error: null };

const CATEGORY_LABELS: Record<string, string> = {
  general: "Compulsory topic",
  fair_trading_forum: "Fair Trading forum",
  austrac_aml: "AUSTRAC AML training",
  assistant_unit: "Unit of competency",
};

// One person's CPD for the year. Lifted out of the licence register, where it
// was a progress bar under a licence number — see the note at the top of
// dashboard/cpd/page.tsx.
export function CpdPersonCard({
  subject,
  viewerProfile,
  records,
  requirement,
  cpdYearLabel,
}: {
  subject: Profile;
  viewerProfile: Profile;
  records: CpdRecord[];
  requirement: CpdRequirement;
  cpdYearLabel: string;
}) {
  const canEdit = viewerProfile.id === subject.id || Boolean(viewerProfile.is_licensee_in_charge);
  const isAssistant = subject.licence_type === "certificate_of_registration";
  const target = requirement.units ?? requirement.coreHours;
  const logged = records.reduce((sum, r) => sum + Number(r.hours), 0);
  const unit = isAssistant ? "units" : "hrs";

  const [adding, setAdding] = useState(false);
  const [addState, addAction, addPending] = useActionState(addCpdRecord.bind(null, subject.id), initial);
  const [catState, catAction, catPending] = useActionState(updateCpdPracticeCategory.bind(null, subject.id), initial);

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
            {subject.cpd_practice_category
              ? CPD_PRACTICE_CATEGORY_LABELS[subject.cpd_practice_category]
              : isAssistant
                ? "Assistant agent"
                : "No category of practice recorded"}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            target === null
              ? "bg-neutral-100 text-neutral-500"
              : logged >= target
                ? "bg-rc-green/15 text-rc-green-deep"
                : "bg-rc-amber/20 text-rc-amber-deep"
          }`}
        >
          {target === null ? `${logged} ${unit} logged` : `${logged}/${target} ${unit}`}
        </span>
      </div>

      {target !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full ${logged >= target ? "bg-rc-green-deep" : "bg-rc-amber-deep"}`}
            style={{ width: `${Math.min(100, (logged / target) * 100)}%` }}
          />
        </div>
      )}

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

      {/* The category is what the hours depend on, so it's asked here as well
          as on the plan — whichever screen someone is on when they notice. */}
      {canEdit && !subject.cpd_practice_category && !isAssistant && (
        <form action={catAction} className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 px-3 py-2">
          <span className="text-xs text-rc-muted">Category of practice:</span>
          <select name="cpdPracticeCategory" defaultValue="" className="rounded-md border border-rc-border px-2 py-1 text-xs">
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

      <div className="mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-rc-muted">{cpdYearLabel} activities</p>
          {canEdit && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-xs font-medium text-rc-green-deep hover:underline"
            >
              {adding ? "Cancel" : "+ Log CPD"}
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <p className="mt-1 text-xs text-rc-faint">Nothing logged for this year yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {records.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="text-rc-ink">
                    {r.activity_name}{" "}
                    <span className="text-neutral-600">
                      — {CATEGORY_LABELS[r.category] ?? r.category} · {r.hours}
                      {isAssistant && r.category === "assistant_unit" ? "u" : "h"} · {r.completed_date}
                    </span>
                  </p>
                  {r.provider ? (
                    <p className="mt-0.5 text-rc-faint">{r.provider}</p>
                  ) : (
                    <p className="mt-0.5 text-rc-amber-deep">
                      No provider recorded — can&rsquo;t be shown to qualify as CPD.
                    </p>
                  )}
                  {r.notes?.includes("NEEDS CHECK") && (
                    <p className="mt-0.5 text-rc-amber-deep">
                      Auto-logged from an office session before providers were checked. Confirm or remove it.
                    </p>
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => deleteCpdRecord(r.id)}
                    aria-label="Remove"
                    className="shrink-0 text-rc-faint transition hover:text-rc-amber-deep"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <form
            action={async (fd) => {
              await addAction(fd);
              setAdding(false);
            }}
            className="mt-3 space-y-2 rounded-md border border-rc-border p-2"
          >
            <input
              type="text"
              name="activityName"
              placeholder="Activity name (e.g. 'Underquoting and pricing obligations')"
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <input
              type="text"
              name="provider"
              placeholder="Approved provider (e.g. REINSW) — required"
              className="w-full rounded-md border border-rc-border px-2 py-1 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select name="category" defaultValue={isAssistant ? "assistant_unit" : "general"} className="rounded-md border border-rc-border px-2 py-1 text-sm">
                <option value="general">Compulsory topic</option>
                <option value="fair_trading_forum">Fair Trading forum</option>
                <option value="austrac_aml">AUSTRAC AML training</option>
                <option value="assistant_unit">Unit of competency</option>
              </select>
              <input
                type="number"
                step="0.5"
                min="0"
                name="hours"
                placeholder={isAssistant ? "Units" : "Hours"}
                className="w-24 rounded-md border border-rc-border px-2 py-1 text-sm"
              />
              <input type="date" name="completedDate" className="rounded-md border border-rc-border px-2 py-1 text-sm" />
            </div>
            <textarea name="notes" rows={1} placeholder="Notes (optional)" className="w-full rounded-md border border-rc-border px-2 py-1 text-sm" />
            <button
              type="submit"
              disabled={addPending}
              className="rounded-md bg-rc-green-deep px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Save
            </button>
            {addState.error && <p className="text-xs text-rc-amber-deep">{addState.error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
