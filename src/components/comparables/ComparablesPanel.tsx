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
  differencesFrom,
  hasSubjectDetail,
  similaritiesFrom,
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
// READ-ONLY SINCE 7 Sep 2026. This used to be a form asking for beds, baths,
// car, land, internal area and condition. Those are now captured with the
// address at listing set-up (Adam: "that needs to be moved into the initial
// listing setup page"), so asking again here would be exactly the double entry
// this product exists to remove.
//
// What stays is the one thing that cannot happen at set-up: the comparables
// report often states the subject's own figures, and where the agent left a
// box empty the report can fill it — offered as a suggestion they accept, not
// applied. A figure a model read off a PDF and a figure the agent stands
// behind are still different things, and attributes_confirmed_at is what tells
// them apart.

function SubjectRow({ propertyId, subject }: { propertyId: string; subject: SubjectAttributes }) {
  const boundAction = confirmSubjectAttributes.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initial);

  const suggested = subject.suggestions;
  const missing = !hasSubjectDetail(subject);
  const canSuggest = missing && Boolean(suggested);

  return (
    <div className="rounded-md border border-rc-border bg-white px-2.5 py-2">
      <p className="text-[11px] font-semibold text-rc-ink">This property</p>
      <p className="mt-0.5 text-[11px] text-rc-muted">
        {hasSubjectDetail(subject) ? subjectSpec(subject) : "No details recorded yet."}
      </p>

      {missing && !canSuggest && (
        <p className="mt-1 text-[11px] leading-relaxed text-rc-faint">
          Add the beds, baths, car spaces and land size in <strong>Edit listing details</strong> at the top of
          this page, and each sale below will be compared against them.
        </p>
      )}

      {canSuggest && (
        <form action={formAction} className="mt-1.5">
          {/* Hidden, because the agent is accepting figures they can see in
              the sentence above rather than filling in a form. Every value is
              carried through so accepting cannot silently blank one. */}
          <input type="hidden" name="bedrooms" value={suggested?.bedrooms ?? ""} />
          <input type="hidden" name="bathrooms" value={suggested?.bathrooms ?? ""} />
          <input type="hidden" name="carSpaces" value={suggested?.carSpaces ?? ""} />
          <input type="hidden" name="landSizeSqm" value={suggested?.landSizeSqm ?? ""} />
          <input type="hidden" name="internalAreaSqm" value={suggested?.internalAreaSqm ?? ""} />
          <input type="hidden" name="conditionNote" value={subject.conditionNote ?? ""} />
          <p className="text-[11px] leading-relaxed text-rc-muted">
            The comparables report says {suggestedSpec(suggested)}. Nothing is used until you accept it.
          </p>
          <button
            type="submit"
            disabled={pending}
            className="mt-1.5 rounded-full bg-rc-green-deep px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-rc-green-deep-600 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Use these details"}
          </button>
          {state.error && (
            <p role="alert" className="mt-1.5 text-[11px] font-medium text-rc-amber-deep">
              {state.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

function subjectSpec(s: SubjectAttributes): string {
  const bits: string[] = [];
  if (s.bedrooms !== null) bits.push(`${s.bedrooms} bed`);
  if (s.bathrooms !== null) bits.push(`${s.bathrooms} bath`);
  if (s.carSpaces !== null) bits.push(`${s.carSpaces} car`);
  if (s.landSizeSqm !== null) bits.push(`${Math.round(s.landSizeSqm)}m² land`);
  // Shown where a file already carries it, never asked for. See PropertyFigures.
  if (s.internalAreaSqm !== null) bits.push(`${Math.round(s.internalAreaSqm)}m² internal`);
  const spec = bits.join(" · ");
  return s.conditionNote ? `${spec}${spec ? " · " : ""}${s.conditionNote}` : spec || "No details recorded yet.";
}

function suggestedSpec(s: SubjectAttributes["suggestions"]): string {
  const bits: string[] = [];
  if (s?.bedrooms != null) bits.push(`${s.bedrooms} bed`);
  if (s?.bathrooms != null) bits.push(`${s.bathrooms} bath`);
  if (s?.carSpaces != null) bits.push(`${s.carSpaces} car`);
  if (s?.landSizeSqm != null) bits.push(`${Math.round(s.landSizeSqm)}m² land`);
  return bits.join(", ") || "nothing it could read";
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

  const similar = similaritiesFrom(subject, comparable);
  const different = differencesFrom(subject, comparable);
  const canCompare = similar.length > 0 || different.length > 0;
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

      {/* Adam's two columns, 7 Sep 2026. Both sides are the same arithmetic —
          "about the same land" is a measurement within a tolerance and
          "1 bedroom fewer" is subtraction. Neither is a judgement, and neither
          says whether the sale is a good comparable: that is the row of
          buttons underneath, and it belongs to the agent. */}
      {canCompare ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border border-rc-border bg-white px-2 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-rc-green-deep">Similar</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {similar.length > 0 ? (
                similar.map((t) => (
                  <span key={t} className="rounded-full bg-rc-green-soft px-2 py-0.5 text-[11px] text-rc-green-deep">
                    {t}
                  </span>
                ))
              ) : (
                <span className="text-[11px] italic text-rc-faint">Nothing matches</span>
              )}
            </div>
          </div>
          <div className="rounded-md border border-rc-border bg-white px-2 py-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-rc-amber-deep">Different</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {different.length > 0 ? (
                different.map((t) => (
                  <span key={t} className="rounded-full bg-rc-amber/15 px-2 py-0.5 text-[11px] text-rc-amber-deep">
                    {t}
                  </span>
                ))
              ) : (
                // NOT "nothing differs", and not "no significant differences"
                // either. Adam raised the first as too blunt on 8 Sep 2026 and
                // suggested the second; the second is worse for a reason worth
                // keeping. "Significant" is a judgement, and the whole defence
                // of this feature is that the software does the arithmetic
                // while the agent forms the opinion — software grading a
                // comparison is the sentence you would least want to explain
                // under s74.
                //
                // "Nothing differs" was also just untrue. The comparison
                // ignores area gaps under AREA_NOISE_SQM and skips any field
                // the report left blank, so what it can honestly report is the
                // absence of a difference IN WHAT IT MEASURED. Saying so also
                // tells the agent that a difference they know of and the
                // report missed is theirs to type in.
                <span className="text-[11px] italic text-rc-faint">
                  No differences on the details recorded
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Said plainly rather than shown as two empty columns. A blank
        // comparison reads as "these are identical", which is the opposite of
        // what a missing figure means.
        <p className="mt-2 rounded-md border border-rc-border bg-white px-2 py-1.5 text-[11px] italic text-rc-faint">
          {hasSubjectDetail(subject)
            ? "The report gave no bed, bath or land figures for this one — nothing to compare until you fill them in."
            : "Add this listing's own details above and each sale will be compared against them."}
        </p>
      )}

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
