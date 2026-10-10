"use client";

// The one way PM asks for a choice (brief B1): the options start grey, the one
// chosen turns green, and a Confirm button elsewhere applies it. Nothing is
// saved by tapping an option.

export function PmChoicePills<K extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  /** When set, the choice is also sent with the form under this name. */
  name?: string;
}) {
  return (
    <div className="basis-full">
      <p className="mb-1.5 text-[13px] text-rc-muted">{label}</p>
      {name && <input type="hidden" name={name} value={value ?? ""} />}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.key)}
              className={`rounded-full border px-3.5 py-1.5 text-left text-[13px] font-semibold transition ${
                on
                  ? "border-rc-green-deep bg-rc-green-deep text-white"
                  : "border-rc-border bg-rc-bg-alt text-rc-muted hover:text-rc-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
