"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, FileCheck2 } from "lucide-react";
import {
  confirmLicenceName,
  fillLicenceGaps,
  rejectLicenceName,
  type ActionState,
  type GapTarget,
  type LicenceReadResult,
} from "@/lib/actions/licences";
import { NameQuestionBox } from "@/components/NameQuestionBox";
import { formatAuTimestamp } from "@/lib/format-date";
import { LICENCE_FIELD_LABELS, type LicenceField, type LicenceReadState } from "@/lib/licence-read";

// What the register says about a licence record that was read off a document.
//
// Four jobs, in order of how much they matter:
//   1. When the name on a person's licence isn't their name in RealComply,
//      the question: "Is this [person]'s licence?" with what was read, not
//      saved yet (15 Oct 2026). Yes saves it; No removes the file. And a
//      warning when an upload is refused because it isn't a licence at all.
//      Both shown once, in the browser that uploaded it: nothing is stored
//      until the question is answered (10 Oct 2026).
//   2. The fields that could not be read, each asked for on its own.
//   3. Where each value came from: read from which document, or typed by whom,
//      and when. "Change" is the existing Edit control on the card.
//   4. The one-off "Read from document" for a record that has a file but no
//      details, for the licensee.

const initial: ActionState = { error: null };

export function LicenceReadNotice({
  state,
  target,
  nameOf,
  canEdit,
  canReread,
  onReread,
  lastResult,
}: {
  state: LicenceReadState | null;
  target: GapTarget;
  nameOf: Record<string, string>;
  canEdit: boolean;
  /** Offer "Read from document": a file is on record and details are missing. */
  canReread: boolean;
  onReread: () => Promise<LicenceReadResult>;
  /** The result of an upload or read just now in this browser, if any. */
  lastResult: LicenceReadResult | null;
}) {
  const [reading, setReading] = useState(false);
  const [readResult, setReadResult] = useState<LicenceReadResult | null>(null);
  const latest = readResult ?? lastResult;
  // The answer to a name question replaces the question, until the next
  // upload or read brings something new.
  const [answered, setAnswered] = useState<{ to: LicenceReadResult; result: LicenceReadResult } | null>(null);
  const shown = answered && answered.to === latest ? answered.result : latest;

  const lastRead = state?.lastRead ?? null;
  const refused = shown?.outcome === "name_mismatch" || shown?.outcome === "not_a_licence";
  const question = shown?.outcome === "confirm_name" ? shown.question ?? null : null;

  const documentFields = state
    ? (Object.entries(state.fields) as [LicenceField, { source: string; by: string | null; at: string }][])
        .filter(([, f]) => f.source === "document")
        .map(([k]) => k)
    : [];
  const typedFields = state
    ? (Object.entries(state.fields) as [LicenceField, { source: string; by: string | null; at: string }][]).filter(
        ([, f]) => f.source === "typed",
      )
    : [];

  async function reread() {
    setReading(true);
    setReadResult(await onReread());
    setReading(false);
  }

  return (
    <div className="mt-2 space-y-1.5 text-[11px]">
      {refused && shown?.message && (
        <p className="flex items-start gap-1.5 rounded-md bg-rc-red-soft px-2 py-1.5 text-rc-red" role="alert">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{shown.message}</span>
        </p>
      )}

      {question && latest && (
        <NameQuestionBox
          word="licence"
          question={question}
          onAnswer={async (yes) => {
            const result = yes ? await confirmLicenceName(question.token) : await rejectLicenceName(question.token);
            if (result.error) return result.error;
            setAnswered({ to: latest, result });
            return null;
          }}
        />
      )}

      {shown?.message && !refused && (
        <p
          className={
            shown.outcome === "saved" ? "text-rc-green-deep" : shown.outcome === "removed" ? "text-rc-muted" : "text-rc-amber-deep"
          }
        >
          {shown.message}
        </p>
      )}
      {shown?.error && <p className="text-rc-amber-deep">{shown.error}</p>}

      {/* The name on the licence, when it isn't the person's name here and
          someone confirmed it is theirs (15 Oct 2026). */}
      {lastRead?.status === "read" && lastRead.nameConfirmed && lastRead.nameOnDocument && (
        <p className="text-rc-muted">
          Name on licence: {lastRead.nameOnDocument}. Confirmed as {lastRead.nameConfirmed.as} by{" "}
          {(lastRead.nameConfirmed.by && nameOf[lastRead.nameConfirmed.by]) || "a team member"} on{" "}
          {formatAuTimestamp(lastRead.nameConfirmed.at)}.
        </p>
      )}

      {lastRead?.status === "could_not_read" && (
        <p className="text-rc-amber-deep">
          {lastRead.fileName ?? "The document"} couldn&rsquo;t be read, so the details need adding by hand.
        </p>
      )}

      {documentFields.length > 0 && lastRead && (
        <p className="flex items-center gap-1.5 text-rc-muted">
          <FileCheck2 size={11} className="text-rc-green-deep" />
          {fieldList(documentFields)} read from {lastRead.fileName ?? "the document"} on {formatAuTimestamp(lastRead.at)}.
          {canEdit && " Use Edit to change anything that's wrong."}
        </p>
      )}
      {typedFields.map(([field, f]) => (
        <p key={field} className="text-rc-muted">
          {capitalise(LICENCE_FIELD_LABELS[field])} typed by {(f.by && nameOf[f.by]) || "a team member"} on{" "}
          {formatAuTimestamp(f.at)}.
        </p>
      ))}

      {state && state.missing.length > 0 && (
        <GapForm target={target} missing={state.missing} canEdit={canEdit} />
      )}

      {canReread && (
        <button
          type="button"
          onClick={reread}
          disabled={reading}
          className="rounded-md border border-rc-border px-2 py-0.5 font-medium text-rc-green-deep hover:bg-rc-green-soft disabled:opacity-60"
        >
          {reading ? "Reading…" : "Read from document"}
        </button>
      )}
    </div>
  );
}

function GapForm({ target, missing, canEdit }: { target: GapTarget; missing: LicenceField[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(fillLicenceGaps.bind(null, target), initial);
  const names = missing.map((f) => LICENCE_FIELD_LABELS[f]);

  if (!canEdit) {
    return <p className="text-rc-amber-deep">Couldn&rsquo;t read the {joinAnd(names)} from the document.</p>;
  }

  return (
    <form action={action} className="rounded-md border border-rc-amber/40 bg-rc-amber/10 px-2 py-1.5">
      <p className="text-rc-amber-deep">
        Couldn&rsquo;t read the {joinAnd(names)} from the document. Please add {missing.length === 1 ? "it" : "them"}:
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {missing.includes("holderName") && (
          <input name="holder" placeholder="Licence holder" className="rounded-md border border-rc-border px-2 py-0.5 text-xs" />
        )}
        {missing.includes("licenceType") && (
          <select name="licenceType" defaultValue="" className="rounded-md border border-rc-border px-2 py-0.5 text-xs">
            <option value="">Licence type…</option>
            <option value="class_1">Class 1 licence</option>
            <option value="class_2">Class 2 licence</option>
            <option value="certificate_of_registration">Certificate of registration</option>
          </select>
        )}
        {missing.includes("licenceNumber") && (
          <input name="licenceNumber" placeholder="Number" className="w-32 rounded-md border border-rc-border px-2 py-0.5 text-xs" />
        )}
        {missing.includes("expiry") && (
          <label className="flex items-center gap-1 text-rc-muted">
            Expiry
            <input type="date" name="expiry" className="rounded-md border border-rc-border px-2 py-0.5 text-xs" />
          </label>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-rc-green-deep px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          Save
        </button>
      </div>
      {state.error && <p className="mt-1 text-rc-amber-deep">{state.error}</p>}
    </form>
  );
}

function fieldList(fields: LicenceField[]): string {
  return capitalise(joinAnd(fields.map((f) => LICENCE_FIELD_LABELS[f])));
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
