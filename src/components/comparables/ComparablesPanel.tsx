"use client";

import { useViewerAccess } from "@/components/ViewerAccess";
import { useActionState, useContext, useState, useTransition } from "react";
import { Plus, X, Check } from "lucide-react";
import { DictateButton, DictationSuspended, appendDictated } from "@/components/Dictate";
import {
  addComparable,
  confirmSubjectAttributes,
  removeComparable,
  setComparableNote,
  setComparableWeighting,
  type ComparableActionState,
} from "@/lib/actions/comparables";
import {
  comparableFolded,
  differencesFrom,
  foldsWhenMarked,
  hasSubjectDetail,
  similaritiesFrom,
  weighingProgress,
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

// "NOT COMPARABLE" REMOVED, 29 Sep 2026 (Adam): "if it's not a comparable
// property, it shouldn't be there." A sale that doesn't belong is now removed
// with the X, not marked. The option was designed on 7 Sep on the argument that
// a sale looked at and ruled out is evidence too; Adam weighed that and chose
// the shorter list. Reversal recorded in RealComply-on-market-properties-design.md.
//
// Rows marked "not comparable" before the change still exist. They keep
// showing the mark (see LEGACY_NOT_COMPARABLE) so the record is not silently
// rewritten, and pressing it clears it the same way any mark is cleared.
const WEIGHTINGS: Array<{ value: Weighting; label: string; help: string }> = [
  { value: "relied", label: "Relied on", help: "This sale informed your estimate" },
  { value: "considered", label: "Considered", help: "You looked at it; it was not decisive" },
];

const LEGACY_NOT_COMPARABLE: { value: Weighting; label: string; help: string } = {
  value: "not_comparable",
  label: "Not comparable",
  help: "Marked before this option was retired. Press to clear it, or remove the sale with the X.",
};

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
      <SubjectDetailsMissing propertyId={propertyId} subject={subject} />

      {comparables.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-rc-muted">
          No sales read from the report yet. Attach a comparable-sales report above and they&rsquo;ll be listed
          here, or add one you know of yourself.
        </p>
      ) : (
        <div className="space-y-2">
          <WeighingCounter comparables={comparables} />
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
// THE SUBJECT BOX IS REMOVED (Adam, 13 Oct 2026). Was: a small box at the top
// of this card, under the "In your own words" note, repeating this listing's
// address, beds, baths and cars. Now: removed, because the address is pinned
// at the top of the page, and the figures are in Edit listing details beside
// it. The box only said again what the agent could already see.
//
// What stays is the part that was never a repeat. The figures have been
// captured at listing set-up since 7 Sep 2026 and are never asked for here,
// but they are optional there. Where a listing has none, the sales below have
// nothing to be compared against, so this still says so, and still offers
// the figures the comparables report gave. Those are offered, not applied: a
// figure a model read off a PDF and a figure the agent stands behind are
// different things, and attributes_confirmed_at is what tells them apart.

function SubjectDetailsMissing({ propertyId, subject }: { propertyId: string; subject: SubjectAttributes }) {
  const boundAction = confirmSubjectAttributes.bind(null, propertyId);
  const [state, formAction, pending] = useActionState(boundAction, initial);

  if (hasSubjectDetail(subject)) return null;

  const suggested = subject.suggestions;
  const canSuggest = Boolean(suggested);

  return (
    <div>
      {!canSuggest && (
        <p className="text-[11px] leading-relaxed text-rc-muted">
          Add the beds, baths, car spaces and land size in <strong>Edit listing details</strong> at the top of
          this page, and each sale below will be compared against them.
        </p>
      )}

      {canSuggest && (
        <form action={formAction}>
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

// ── How many sales are done ───────────────────────────────────────────────
//
// "N of N done" above the list (Adam, 13 Oct 2026, approved mockup), so the
// agent sees the open cards shrink as each sale folds away.

function WeighingCounter({ comparables }: { comparables: Comparable[] }) {
  const { done, total } = weighingProgress(comparables);
  return (
    <div className="flex items-center gap-2.5 text-[11px] font-semibold tabular-nums text-rc-muted">
      <span aria-live="polite">
        {done} of {total} done
      </span>
      <div aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full border border-rc-border bg-rc-bg-alt">
        <div
          className="h-full rounded-full bg-rc-green-deep transition-[width] duration-300"
          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

// ── One sale ──────────────────────────────────────────────────────────────
//
// FOLDS ONCE MARKED (Adam, 13 Oct 2026; approved mockup). Pressing "Relied on"
// or "Considered" folds the card to one line, the same way a finished
// compliance card folds: a green tick, the address, the mark, the sold price
// and date, and "Change", which opens it again. Folding hides the card and
// keeps it mounted, so nothing on it is lost, and it waits until the mark is
// saved: the line only ever shows an answer that is on the record.
//
// Brand green only. "Relied on" is solid green and "Considered" is a green
// outline, as buttons and as the folded label, so the two read apart at a
// glance without a second colour.

function MarkLabel({ weighting }: { weighting: "relied" | "considered" }) {
  return weighting === "relied" ? (
    <span className="shrink-0 rounded-full border border-rc-green-deep bg-rc-green-deep px-2 py-0.5 text-[10px] font-bold text-white">
      Relied on
    </span>
  ) : (
    <span className="shrink-0 rounded-full border border-rc-green-deep bg-white px-2 py-0.5 text-[10px] font-bold text-rc-green-deep">
      Considered
    </span>
  );
}

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

  // "Change" opens a folded card until it is answered again. Reset whenever
  // the saved mark changes, during render rather than in an effect (as in
  // ItemShell), so a card never paints one frame open after its mark lands.
  const [reopened, setReopened] = useState(false);
  const [shownFor, setShownFor] = useState(comparable.weighting);
  if (comparable.weighting !== shownFor) {
    setShownFor(comparable.weighting);
    setReopened(false);
  }
  const folded = comparableFolded({
    weighting: comparable.weighting,
    reopened,
    noteUnsaved: note !== savedNote,
    hasError: error !== null,
  });
  // Dictation stops when this card folds, or when the whole ESP card does.
  const cardFolded = useContext(DictationSuspended);

  function weigh(value: Weighting) {
    setError(null);
    // The answer already on the card, pressed again after "Change": keep it
    // and fold the card back. Taking a mark off is "Clear", below.
    if (value === comparable.weighting && foldsWhenMarked(value)) {
      setReopened(false);
      return;
    }
    startTransition(async () => {
      // The retired "not comparable" mark still clears when pressed, as every
      // mark used to.
      const next = comparable.weighting === value ? null : value;
      const result = await setComparableWeighting(propertyId, comparable.id, next);
      if (result.error) setError(result.error);
    });
  }

  // A mis-tap has to be undoable, and "not answered yet" has to stay
  // reachable: an unweighted row is an honest state.
  function clearMark() {
    setError(null);
    startTransition(async () => {
      const result = await setComparableWeighting(propertyId, comparable.id, null);
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

  const { actsAsLicensee } = useViewerAccess();
  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeComparable(propertyId, comparable.id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div
      className={`rounded-md border transition ${
        folded
          ? "border-rc-green-deep/25 bg-rc-green-soft"
          : comparable.weighting === "relied"
            ? "border-rc-green-deep/35 bg-rc-green-soft/40 px-2.5 py-2"
            : "border-rc-border bg-white px-2.5 py-2"
      } ${dimmed ? "opacity-60" : ""}`}
    >
      {folded && foldsWhenMarked(comparable.weighting) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-2">
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rc-green-deep text-white">
            <Check size={12} strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="min-w-0 truncate text-[13px] font-semibold text-rc-ink">{comparable.address}</span>
          <MarkLabel weighting={comparable.weighting} />
          <span className="ml-auto text-[11px] tabular-nums text-rc-muted">
            {money(comparable.salePrice)}
            {comparable.saleDate ? ` · ${shortDate(comparable.saleDate)}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setReopened(true)}
            aria-label={`Change ${comparable.address}`}
            className="text-[11px] font-semibold text-rc-muted underline underline-offset-2 transition hover:text-rc-ink"
          >
            Change
          </button>
        </div>
      )}

      <div hidden={folded}>
      <DictationSuspended.Provider value={cardFolded || folded}>
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
        {/* Only the licensee removes a row (Adam, 9 Oct 2026). */}
        {actsAsLicensee && (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={`Remove ${comparable.address}`}
            title="Remove this sale — a duplicate, a misread, or one that isn't comparable."
            className="shrink-0 rounded-full p-1 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink disabled:opacity-50"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
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

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(comparable.weighting === "not_comparable" ? [...WEIGHTINGS, LEGACY_NOT_COMPARABLE] : WEIGHTINGS).map((w) => {
          const chosen = comparable.weighting === w.value;
          return (
            <button
              key={w.value}
              type="button"
              onClick={() => weigh(w.value)}
              disabled={pending}
              title={w.help}
              aria-pressed={chosen}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-60 ${
                w.value === "relied"
                  ? "border-rc-green-deep bg-rc-green-deep text-white hover:border-rc-green-deep-600 hover:bg-rc-green-deep-600"
                  : w.value === "considered"
                    ? "border-rc-green-deep bg-white text-rc-green-deep hover:bg-rc-green-soft"
                    : chosen
                      ? "border-rc-green-deep bg-rc-green-deep text-white"
                      : "border-rc-border bg-white text-rc-muted hover:border-rc-ink/20 hover:text-rc-ink"
              } ${chosen && foldsWhenMarked(w.value) ? "ring-2 ring-rc-green-deep/30 ring-offset-1" : ""}`}
            >
              {chosen && <Check size={10} aria-hidden="true" />}
              {w.label}
            </button>
          );
        })}
        {foldsWhenMarked(comparable.weighting) && (
          <button
            type="button"
            onClick={clearMark}
            disabled={pending}
            title="Take the mark off this sale"
            className="ml-1 text-[11px] font-semibold text-rc-muted underline underline-offset-2 transition hover:text-rc-ink disabled:opacity-60"
          >
            Clear
          </button>
        )}
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
      </DictationSuspended.Provider>
      </div>
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
