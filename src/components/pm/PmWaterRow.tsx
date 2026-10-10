"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { setPmWater } from "@/lib/actions/pm";
import { formatAuDateTimeShort } from "@/lib/format-date";
import {
  PM_WATER_QUESTIONS,
  pmWaterResult,
  type PmItem,
  type PmWaterAnswers,
} from "@/lib/rules/nsw-pm";
import { PmChoicePills } from "@/components/pm/PmChoicePills";

// Water usage, in Money and move-in (brief B5). Up to three questions, asked
// one at a time, each with Yes and No and a Confirm. "No" to the first or
// second finishes the item. "Yes" to the third finishes it; "No" leaves it
// open, which holds the stage and so blocks move-in. Saved once the answers
// reach an end. A finished item has a Change button that asks again.
// Never the word "certificate".

const YES_NO = [
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
] as const;

export type PmWaterSaved = {
  state: "done" | "na" | "open";
  answers: PmWaterAnswers;
  byName: string;
  at: string;
} | null;

export function PmWaterRow({
  propertyId,
  item,
  saved,
  striped,
}: {
  propertyId: string;
  item: PmItem;
  saved: PmWaterSaved;
  striped: boolean;
}) {
  const savedResult = saved ? pmWaterResult(saved.answers) : null;
  const hasEnd = savedResult !== null && savedResult.next === null;
  const [asking, setAsking] = useState(!hasEnd);
  const [answers, setAnswers] = useState<PmWaterAnswers>({});
  const [choice, setChoice] = useState<"yes" | "no" | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showRef, setShowRef] = useState(false);

  const current = pmWaterResult(answers);
  const question = PM_WATER_QUESTIONS.find((q) => q.key === current.next);
  const done = hasEnd && saved?.state === "done" && !asking;

  function confirm() {
    if (!question || !choice) return;
    const next = { ...answers, [question.key]: choice === "yes" };
    setChoice(null);
    setError(null);
    if (pmWaterResult(next).next !== null) {
      setAnswers(next);
      return;
    }
    startTransition(async () => {
      const result = await setPmWater(propertyId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      setAnswers({});
      setAsking(false);
    });
  }

  function change() {
    setAnswers({});
    setChoice(null);
    setAsking(true);
  }

  return (
    <li className={`flex items-start gap-3 border-t border-rc-border px-4 py-3 ${striped ? "bg-rc-bg-alt" : ""}`}>
      <input type="checkbox" checked={done} disabled readOnly aria-label={item.title} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-rc-green-deep" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          <span className={`text-sm ${done ? "font-medium text-rc-muted line-through" : "font-semibold text-rc-ink"}`}>{item.title}</span>
          <button
            type="button"
            onClick={() => setShowRef((s) => !s)}
            aria-expanded={showRef}
            aria-label={`Legal basis for ${item.title}`}
            className="mt-px shrink-0 rounded-full p-0.5 text-rc-faint transition hover:text-rc-green-deep"
          >
            <Info size={13} aria-hidden="true" />
          </button>
        </div>
        {!done && <p className="text-[13px] text-rc-muted">{item.help}</p>}
        {showRef && <p className="mt-0.5 text-xs text-rc-faint">Legal basis: {item.reference}</p>}

        {hasEnd && !asking && savedResult?.line && (
          <p className={`mt-0.5 text-[13px] ${saved?.state === "done" ? "text-rc-ink" : "font-semibold text-rc-amber-deep"}`}>
            {savedResult.line}
          </p>
        )}
        {hasEnd && !asking && saved && (
          <p className={`mt-0.5 text-[12.5px] font-semibold ${saved.state === "done" ? "text-rc-green-deep" : "text-rc-muted"}`}>
            {saved.state === "done" ? "✓ " : ""}
            {saved.byName} · {formatAuDateTimeShort(saved.at)}
            <button type="button" onClick={change} className="ml-2 font-semibold text-rc-green-deep underline-offset-2 hover:underline">
              Change
            </button>
          </p>
        )}

        {asking && question && (
          <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-rc-border bg-white px-3 py-2.5">
            {PM_WATER_QUESTIONS.filter((q) => answers[q.key] !== undefined).map((q) => (
              <p key={q.key} className="basis-full text-[12.5px] text-rc-muted">
                {q.text} <b className="font-semibold text-rc-ink">{answers[q.key] ? "Yes" : "No"}</b>
              </p>
            ))}
            <PmChoicePills label={question.text} options={YES_NO} value={choice} onChange={setChoice} />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!choice || pending}
                onClick={confirm}
                className="rounded-full bg-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {pending ? "Saving…" : "Confirm"}
              </button>
              {(hasEnd || Object.keys(answers).length > 0) && (
                <button
                  type="button"
                  onClick={() => {
                    setAnswers({});
                    setChoice(null);
                    setAsking(!hasEnd);
                  }}
                  className="rounded-full border border-rc-green-deep px-4 py-1.5 text-[13px] font-semibold text-rc-green-deep transition hover:bg-rc-green-soft"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-1 text-xs font-medium text-rc-red">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
