"use client";

import { useState } from "react";
import { LICENCE_CATEGORY_GROUPS, LICENCE_CATEGORY_LABELS, LICENCE_LABELS, cleanLicenceCategories } from "@/lib/rules/nsw-cpd";
import type { LicenceType, Profile } from "@/lib/types";

// The licence: its class, and every type of licence held, ticked (Adam,
// 14 Oct 2026: "select which class of license they hold... Keep it simple").
// Grouped the way Fair Trading groups them. Trent Lloyd ticks residential
// sales, business broking and stock and station.
//
// Lives inside the licence card's edit form, where the single category of
// practice was (Adam, 18 Aug 2026: asked once, beside the licence). The form
// posts licenceType and licenceCategories (one per tick); licenceCategoriesShown
// says the ticks were on screen.

const box =
  "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-rc-green-deep text-[11px] font-extrabold text-white peer-checked:bg-rc-green-deep peer-focus-visible:ring-2 peer-focus-visible:ring-rc-green-deep/40";

function Tick({
  name,
  value,
  type = "checkbox",
  checked,
  onChange,
  children,
}: {
  name: string;
  value: string;
  type?: "checkbox" | "radio";
  checked: boolean;
  onChange: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-rc-ink">
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span aria-hidden className={box}>
        {checked ? "✓" : ""}
      </span>
      <span>{children}</span>
    </label>
  );
}

export function LicenceTypes({ profile }: { profile: Profile }) {
  const [licence, setLicence] = useState<LicenceType | "">(profile.licence_type ?? "");
  const [ticked, setTicked] = useState<string[]>(cleanLicenceCategories(profile.licence_categories));

  return (
    <fieldset className="space-y-3 rounded-md border border-rc-border bg-white px-3 py-3">
      <legend className="px-1 text-sm font-semibold text-rc-ink">Licence</legend>
      <input type="hidden" name="licenceCategoriesShown" value="1" />
      <p className="text-xs text-rc-muted">Tick your class, and every type of licence you hold.</p>

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-rc-muted">Class</h4>
        {(Object.keys(LICENCE_LABELS) as LicenceType[]).map((t) => (
          <Tick key={t} name="licenceType" value={t} type="radio" checked={licence === t} onChange={() => setLicence(t)}>
            {LICENCE_LABELS[t]}
          </Tick>
        ))}
        {/* No class ticked still posts as "not set", as the old select did. */}
        {licence === "" && <input type="hidden" name="licenceType" value="" />}
      </div>

      {LICENCE_CATEGORY_GROUPS.map((g) => (
        <div key={g.title} className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-rc-muted">{g.title}</h4>
          {g.categories.map((c) => (
            <Tick
              key={c}
              name="licenceCategories"
              value={c}
              checked={ticked.includes(c)}
              onChange={(on) => setTicked((t) => (on ? [...t, c] : t.filter((x) => x !== c)))}
            >
              {LICENCE_CATEGORY_LABELS[c]}
            </Tick>
          ))}
        </div>
      ))}
    </fieldset>
  );
}
