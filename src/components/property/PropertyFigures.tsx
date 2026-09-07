"use client";

// Beds, baths, car spaces and land size.
//
// MOVED TO SET-UP, 7 Sep 2026. These were being asked for on the Estimated
// selling price card, which was wrong twice over: it put a form in front of an
// agent halfway through a compliance item, and it meant the comparison against
// the comparable sales stayed blank until they filled it in — the one place
// the figures actually earn their keep.
//
// Adam: "that needs to be moved into the initial listing setup page when we
// put the address in to open up the listing."
//
// INTERNAL AREA IS DELIBERATELY ABSENT. Adam: "get rid of internal square
// meters as an option because that's not something that may necessarily be
// known at that point in time." He is right, and the general principle is
// worth holding: a set-up form should only ask for what somebody opening a
// file already has in front of them. Anything else is a blank box that makes
// the form look unfinished. The column stays in the database so files that
// already carry the figure keep it — nothing asks for it any more.
//
// Every field is optional. A listing opened before anyone has measured the
// block should not be blocked; the comparison simply says less until the
// figures arrive.

const FIELDS: Array<{ name: string; label: string; placeholder: string; wide?: boolean }> = [
  { name: "bedrooms", label: "Beds", placeholder: "4" },
  { name: "bathrooms", label: "Baths", placeholder: "2" },
  { name: "carSpaces", label: "Car", placeholder: "2" },
  { name: "landSizeSqm", label: "Land m²", placeholder: "600", wide: true },
];

export function PropertyFigures({
  values,
}: {
  /** Current values when editing an existing listing. Omitted when creating. */
  values?: Partial<Record<string, number | null>>;
}) {
  return (
    <div>
      <p className="block text-sm font-medium text-rc-ink">The property</p>
      <p className="mt-0.5 text-xs text-rc-muted">
        Used to compare this property against the sales in your comparables report. Leave anything you
        don&rsquo;t know yet — you can add it later.
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {FIELDS.map((f) => (
          <label key={f.name} htmlFor={f.name} className="block text-xs font-medium text-rc-muted">
            {f.label}
            <input
              id={f.name}
              name={f.name}
              type="text"
              inputMode="decimal"
              placeholder={f.placeholder}
              defaultValue={values?.[f.name] ?? ""}
              className="mt-1 w-full rounded-lg border border-rc-border px-2.5 py-2 text-sm transition focus:border-rc-green-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
