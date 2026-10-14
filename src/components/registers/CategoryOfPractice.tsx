"use client";

import { useState } from "react";
import {
  CPD_CATEGORY_GROUPS,
  CPD_CATEGORY_LABELS,
  LICENCE_LABELS,
  cleanCpdCategories,
  cpdRulesetFor,
} from "@/lib/rules/nsw-cpd";
import { currentCpdYear } from "@/lib/cpd-year";
import { formatAuDate } from "@/lib/format-date";
import type { LicenceType, Profile } from "@/lib/types";

// Category of practice: tick all that apply (brief of 14 Oct 2026, Part 1;
// mockup tab 1). Per person, grouped the way Fair Trading groups them: the
// licence (one of three), then every real estate area and other category the
// person works in. It sets their CPD for the year.
//
// Lives inside the licence card's edit form, as the single category did
// (Adam, 18 Aug 2026: asked once, beside the licence, which changes about as
// often). The form posts licenceType, cpdCategories (one per tick),
// cpdLivestockOnly and licenceStartedOn; cpdShown says these were on screen.

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

export function CategoryOfPractice({ profile }: { profile: Profile }) {
  const [licence, setLicence] = useState<LicenceType | "">(profile.licence_type ?? "");
  const [ticked, setTicked] = useState<string[]>(cleanCpdCategories(profile.cpd_categories));
  const [livestock, setLivestock] = useState(Boolean(profile.cpd_livestock_only));
  const assistant = licence === "certificate_of_registration";
  // The part-year rules come from this year's ruleset, never from here.
  const from = cpdRulesetFor(currentCpdYear().start)?.assistant.partYearFrom ?? null;

  return (
    <fieldset className="space-y-3 rounded-md border border-rc-border bg-white px-3 py-3">
      <legend className="px-1 text-sm font-semibold text-rc-ink">Category of practice</legend>
      <input type="hidden" name="cpdShown" value="1" />
      <p className="text-xs text-rc-muted">Tick every category and area you work in. This sets your CPD for the year.</p>

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-rc-muted">Licence</h4>
        {(Object.keys(LICENCE_LABELS) as LicenceType[]).map((t) => (
          <Tick key={t} name="licenceType" value={t} type="radio" checked={licence === t} onChange={() => setLicence(t)}>
            {LICENCE_LABELS[t]}
          </Tick>
        ))}
        {/* An unticked licence still posts as "not set", as the old select did. */}
        {licence === "" && <input type="hidden" name="licenceType" value="" />}
      </div>

      {CPD_CATEGORY_GROUPS.map((g) => (
        <div key={g.title} className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-rc-muted">{g.title}</h4>
          {g.categories.map((c) => (
            <Tick
              key={c}
              name="cpdCategories"
              value={c}
              checked={ticked.includes(c)}
              onChange={(on) => setTicked((t) => (on ? [...t, c] : t.filter((x) => x !== c)))}
            >
              {CPD_CATEGORY_LABELS[c]}
            </Tick>
          ))}
        </div>
      ))}

      {assistant && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-rc-muted">Assistant agents</h4>
          <Tick name="cpdLivestockOnly" value="on" checked={livestock} onChange={setLivestock}>
            Stock and station, livestock sales only
          </Tick>
          <p className="text-[11px] text-rc-faint">Exempt from CPD.</p>
        </div>
      )}

      <label className="block">
        <span className="block text-xs text-rc-muted">Licence or certificate started</span>
        <input
          type="date"
          name="licenceStartedOn"
          defaultValue={profile.licence_started_on ?? ""}
          className="mt-1 rounded-md border border-rc-border px-2 py-1 text-sm"
        />
        <span className="mt-0.5 block text-[11px] text-rc-faint">
          {from
            ? `Only needed if it started on or after ${formatAuDate(from)}. A late start means less CPD, or none, for the year.`
            : "Only needed if it started part way through this CPD year."}
        </span>
      </label>

      <p className="text-[11px] text-rc-faint">Read from your licence where we can. Check and change here.</p>
    </fieldset>
  );
}
