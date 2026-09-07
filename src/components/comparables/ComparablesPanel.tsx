"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X, Check } from "lucide-react";
import { DictateButton, appendDictated } from "@/components/Dictate";
import {
  addComparable,
  confirmSubjectAttributes,
  removeComparable,
  setComparableNote,
  setComparableWeighting,
  type ComparableActionState,
} from "@/lib/actions/comparables";
import {
  differenceLine,
  hasSubjectDetail,
  type Comparable,
  type SubjectAttributes,
  type Weighting,
} from "@/lib/data/comparables";

// The comparable sales, stacked against this listing.
//
// WHAT THIS IS FOR. s72A(5) requires the agent to hold evidence that their
// estimated selling price is reasonable. The report on the card above is that
// evidence; this is where the agent records what they made of it. The facts in
// each row were read off the report. The three buttons and the note on each
// row are the only things here that a person supplies, and they are the only
// things here that constitute a judgement.
//
// NOTHING IS EVER PRE-SELECTED. A weighting that arrived by default would be a
// record of a decision nobody made, on the one figure most likely to be
// challenged under s74. Adam rejected pre-ticking once already, on the REINSW
// factors, 24 Aug 2026 — the same reasoning applies with more force here,
// because these buttons are the record rather than a prompt.

const initial: ComparableActionState = { error: null };

const WEIGHTINGS: Array<{ value: Weighting; label: string; help: string }> = [
  { value: "relied", label: "Relied on", help: "This sale informed your estimate" },
  { value: "considered", label: "Considered", help: "You looked at it; it was not decisive" },
  { value: "not_comparable", label: "Not comparable", help: "You looked at it and ruled it out" },
];

function money(n: number | null): string {
  return n === null ? "—" : `$${Math.round(n).toLocaleString("en-AU")}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function spec(c: Comparable): string {
  const bits: string[] = [];
  if (c.bedrooms !== null) bits.push(`${c.bedrooms} bed`);
  if (c.bathrooms !== null) bits.push(`${c.bathrooms} bath`);
  if (c.carSpaces !== null) bits.push(`${c.carSpaces} car`);
  if (c.landSizeSqm !== null) bits.push(`${Math.round(c.landSizeSqm)}m² land`);
  return bits.join(" · ");
}

export function ComparablesPanel({
  propertyId,
  subject,
  comparables,
}: {
  propertyId: string;
  subject: SubjectAttributes;
  comparables: Comparable[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="mt-3 space-y-3">
      <SubjectRow propertyId={propertyId} subject={subject} />

      {comparables.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-rc-muted">
          No sales read from the report yet. Attach a comparable-sales report above and they&rsquo;ll be listed
          here, or add one you know of yourself.
        </p>
      ) : (
        <div className="space-y-2">
          {comparables.map((c) => (
            <ComparableRow key={c.id} propertyId={propertyId} subject={subject} comparable={c} />
          ))}
        </div>
      )}

      {adding ? (
        <AddComparable propertyId={propertyId} onDone={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-rc-border bg-white px-3 py-1.5 text-xs font-semibold text-rc-ink transition hover:border-rc-ink/20"
        >
          <Plus size={12} aria-hidden="true" />
          Add a sale
        </button>
      )}
    </div>
  );
}

// ── The subject property ──────────────────────────────────────────────────
//
// Read off the report where it states them, and shown for confirmation rather
// than applied. The act being recorded is a person saying "yes, that is my
// property" — a figure a model read off a PDF and a figure the agent stands
// behind are different things, and the compliance record has to tell them
// apart.

function SubjectRow({ propertyId, subject }: { propertyId: string; subject: SubjectAttributes }) {
  const boundAction = confirmSubjectAttributes.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initial);
  const [open, setOpen] = useState(false);

  const suggested = subject.suggestions;
  const needsAnswer = !subject.confirmedAt && !hasSubjectDetail(subject);
  const showForm = open || (needsAnswer && Boolean(suggested));

  const value = (key: keyof SubjectAttributes) =>
    (subject[key] as number | null) ?? (suggested?.[key as keyof typeof suggested] as number | null) ?? "";

  if (!showForm) {
    return (
      <div className="rounded-md border border-rc-border bg-white px-2.5 py-2">
        <p className="text-[11px] font-semibold text-rc-ink">
          This property
          {subject.confirmedAt && <span className="ml-1.5 font-normal text-rc-faint">confirmed</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-rc-muted">
          {hasSubjectDetail(subject) ? subjectSpec(subject) : "No details recorded yet."}
          {subject.conditionNote ? ` · ${subject.conditionNote}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-[11px] font-semibold text-rc-green-deep underline-offset-2 hover:underline"
        >
          {hasSubjectDetail(subject) ? "Edit" : "Add the details"}
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-md border border-rc-green-deep/30 bg-rc-green-soft/40 px-2.5 py-2">
      <p className="text-[11px] font-semibold text-rc-ink">This property</p>
      {suggested && !subject.confirmedAt && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
          Read from the comparables report. Check it and correct anything that&rsquo;s wrong — nothing is used
          until you save it.
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field name="bedrooms" label="Beds" defaultValue={value("bedrooms")} />
        <Field name="bathrooms" label="Baths" defaultValue={value("bathrooms")} />
        <Field name="carSpaces" label="Car" defaultValue={value("carSpaces")} />
        <Field name="landSizeSqm" label="Land m²" defaultValue={value("landSizeSqm")} />
        <Field name="internalAreaSqm" label="Internal m²" defaultValue={value("internalAreaSqm")} />
      </div>

      <label className="mt-2 block text-[11px] font-medium text-rc-muted">
        Condition and anything unusual
        <input
          type="text"
          name="conditionNote"
          defaultValue={subject.conditionNote ?? ""}
          placeholder="Renovated kitchen and bath, battle-axe block"
          className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
        />
      </label>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-semibold text-rc-muted hover:text-rc-ink"
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}

function subjectSpec(s: SubjectAttributes): string {
  const bits: string[] = [];
  if (s.bedrooms !== null) bits.push(`${s.bedrooms} bed`);
  if (s.bathrooms !== null) bits.push(`${s.bathrooms} bath`);
  if (s.carSpaces !== null) bits.push(`${s.carSpaces} car`);
  if (s.landSizeSqm !== null) bits.push(`${Math.round(s.landSizeSqm)}m² land`);
  if (s.internalAreaSqm !== null) bits.push(`${Math.round(s.internalAreaSqm)}m² internal`);
  return bits.join(" · ") || "No details recorded yet.";
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue: number | string;
}) {
  return (
    <label className="block text-[11px] font-medium text-rc-muted">
      {label}
      <input
        type="text"
        inputMode="decimal"
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
      />
    </label>
  );
}

// ── One sale ──────────────────────────────────────────────────────────────

function ComparableRow({
  propertyId,
  subject,
  comparable,
}: {
  propertyId: string;
  subject: SubjectAttributes;
  comparable: Comparable;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState(comparable.agentNote ?? "");
  const [savedNote, setSavedNote] = useState(comparable.agentNote ?? "");
  const [error, setError] = useState<string | null>(null);

  const differences = differenceLine(subject, comparable);
  const dimmed = comparable.weighting === "not_comparable";

  function weigh(value: Weighting) {
    setError(null);
    startTransition(async () => {
      // Pressing the current answer again clears it. A mis-tap has to be
      // undoable, and "not answered yet" has to stay reachable.
      const next = comparable.weighting === value ? null : value;
      const result = await setComparableWeighting(propertyId, comparable.id, next);
      if (result.error) setError(result.error);
    });
  }

  function saveNote() {
    if (note === savedNote) return;
    setError(null);
    startTransition(async () => {
      const result = await setComparableNote(propertyId, comparable.id, note);
      if (result.error) setError(result.error);
      else setSavedNote(note);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeComparable(propertyId, comparable.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      className={`rounded-md border px-2.5 py-2 transition ${
        comparable.weighting === "relied"
          ? "border-rc-green-deep/35 bg-rc-green-soft/40"
          : "border-rc-border bg-white"
      } ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-rc-ink">{comparable.address}</p>
          <p className="mt-0.5 text-[11px] text-rc-muted">
            {money(comparable.salePrice)}
            {comparable.saleDate ? ` · ${shortDate(comparable.saleDate)}` : ""}
            {spec(comparable) ? ` · ${spec(comparable)}` : ""}
            {comparable.distanceM !== null ? ` · ${formatDistance(comparable.distanceM)}` : ""}
          </p>
          {/* Arithmetic, not opinion. "120m² less land" cannot be wrong;
              "broadly comparable" would be a judgement this must never make. */}
          {differences && (
            <p className="mt-0.5 text-[11px] font-medium text-rc-ink">
              Against yours: {differences}
            </p>
          )}
          {comparable.source === "agent" && (
            <p className="mt-0.5 text-[11px] text-rc-faint">Added by you, not from the report.</p>
          )}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Remove ${comparable.address}`}
          title="Remove this row — for a duplicate or a misread. To record that you ruled a sale out, mark it Not comparable instead."
          className="shrink-0 rounded-full p-1 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink disabled:opacity-50"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {WEIGHTINGS.map((w) => (
          <button
            key={w.value}
            type="button"
            onClick={() => weigh(w.value)}
            disabled={pending}
            title={w.help}
            aria-pressed={comparable.weighting === w.value}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
              comparable.weighting === w.value
                ? "bg-rc-green-deep text-white"
                : "border border-rc-border bg-white text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
            }`}
          >
            {comparable.weighting === w.value && <Check size={10} aria-hidden="true" />}
            {w.label}
          </button>
        ))}
      </div>

      {comparable.weighting && (
        <div className="mt-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            rows={2}
            placeholder={
              comparable.weighting === "not_comparable"
                ? "Why not — one line is enough"
                : "What this sale told you — one line is enough"
            }
            className="w-full rounded-md border border-rc-border px-2 py-1.5 text-sm leading-relaxed text-rc-ink"
          />
          <div className="mt-1 flex items-center gap-2">
            <DictateButton onText={(text) => setNote((n) => appendDictated(n, text))} label="Dictate" />
            {note !== savedNote && (
              <button
                type="button"
                onClick={saveNote}
                disabled={pending}
                className="text-[11px] font-semibold text-rc-green-deep hover:underline disabled:opacity-60"
              >
                Save
              </button>
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {error}
        </p>
      )}
    </div>
  );
}

function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)}km away` : `${Math.round(metres)}m away`;
}

// ── A sale the report did not list ────────────────────────────────────────

function AddComparable({ propertyId, onDone }: { propertyId: string; onDone: () => void }) {
  const boundAction = addComparable.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(
    async (prev: ComparableActionState, fd: FormData) => {
      const result = await boundAction(prev, fd);
      if (!result.error) onDone();
      return result;
    },
    initial,
  );

  return (
    <form action={formAction} className="rounded-md border border-rc-border bg-rc-bg-alt px-2.5 py-2">
      <p className="text-[11px] font-semibold text-rc-ink">Add a sale</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-rc-muted">
        One you know of that the report missed. Address is all that&rsquo;s required.
      </p>
      <input
        type="text"
        name="address"
        required
        placeholder="14 Smith St, Mount Colah"
        className="mt-2 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field name="salePrice" label="Sale price" defaultValue="" />
        <label className="block text-[11px] font-medium text-rc-muted">
          Sale date
          <input
            type="date"
            name="saleDate"
            className="mt-1 w-full rounded-md border border-rc-border px-2 py-1.5 text-sm text-rc-ink"
          />
        </label>
        <Field name="landSizeSqm" label="Land m²" defaultValue="" />
        <Field name="bedrooms" label="Beds" defaultValue="" />
        <Field name="bathrooms" label="Baths" defaultValue="" />
        <Field name="carSpaces" label="Car" defaultValue="" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-[11px] font-semibold text-rc-muted hover:text-rc-ink"
        >
          Cancel
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </form>
  );
}
