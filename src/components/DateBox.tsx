"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  DATE_BOX_PLACEHOLDER,
  WEEKDAYS,
  addDaysIso,
  dateBoxProblem,
  inLimits,
  monthGrid,
  parseAuDate,
  shiftMonth,
  showAuDate,
} from "@/lib/date-box";
import { formatSydney, sydneyDate } from "@/lib/format-date";

// THE REALCOMPLY DATE BOX (Adam, 11 Nov 2026): every date box in RealComply,
// always dd/mm/yyyy, whatever the browser or computer is set to. A native
// date box shows the browser's own order, so a computer set to the US showed
// 4 November as "11/04/2026".
//
// It takes the props a native date box took (name, value or defaultValue,
// onChange, required, min, max, disabled, id, aria-label, className), and
// stores what it stored: YYYY-MM-DD, under the same name, in a hidden field.
// So the forms and the actions behind them are unchanged. onChange is called
// as a native date box calls it: with a complete date, or "" while there
// isn't one.
//
// Type the date (day first: 4/11/2026, 04-11-2026, 04112026) or pick it from
// the calendar, whose weeks start on Monday. A date that isn't one, or is
// outside min and max, holds the form back and says why, as a native box
// does. The rules are in lib/date-box.ts.

type DateBoxChange = { target: { value: string; name: string } };

export type DateBoxProps = {
  name?: string;
  /** YYYY-MM-DD, or "" for none. Given: the box follows it (controlled). */
  value?: string;
  /** YYYY-MM-DD, or "" for none. The starting value when `value` isn't given. */
  defaultValue?: string;
  onChange?: (e: DateBoxChange) => void;
  required?: boolean;
  /** YYYY-MM-DD: the earliest date allowed. */
  min?: string;
  /** YYYY-MM-DD: the latest date allowed. */
  max?: string;
  disabled?: boolean;
  id?: string;
  form?: string;
  /** For the text box, as on the native one. */
  className?: string;
  "aria-label"?: string;
  /** Accepted for a native box's sake; the box always asks for dd/mm/yyyy. */
  placeholder?: string;
};

const WIDTH = /(^|\s)(w-|min-w-|max-w-|flex-1)/;

export function DateBox({
  name,
  value,
  defaultValue,
  onChange,
  required,
  min,
  max,
  disabled,
  id,
  form,
  className = "",
  "aria-label": ariaLabel,
}: DateBoxProps) {
  const controlled = value !== undefined;
  const [iso, setIso] = useState<string>(() => (controlled ? value : defaultValue) ?? "");
  const [text, setText] = useState<string>(() => showAuDate((controlled ? value : defaultValue) ?? ""));
  const [open, setOpen] = useState(false);
  const lastSent = useRef<string>((controlled ? value : defaultValue) ?? "");
  const input = useRef<HTMLInputElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const calendarId = useId();

  // A controlled box follows its value when it's changed from outside.
  useEffect(() => {
    if (!controlled) return;
    const next = value ?? "";
    if (next !== lastSent.current) {
      lastSent.current = next;
      setIso(next);
      setText(showAuDate(next));
    }
  }, [controlled, value]);

  // A date that isn't one, or is out of range, holds the form back, as a native box does.
  const problem = dateBoxProblem(text, { min, max });
  useEffect(() => {
    input.current?.setCustomValidity(problem ?? "");
  }, [problem]);

  const commit = useCallback(
    (next: string) => {
      setIso(next);
      if (next !== lastSent.current) {
        lastSent.current = next;
        onChange?.({ target: { value: next, name: name ?? "" } });
      }
    },
    [name, onChange],
  );

  const typed = (raw: string) => {
    setText(raw);
    const parsed = parseAuDate(raw);
    commit(parsed && inLimits(parsed, { min, max }) ? parsed : "");
  };

  const pick = (day: string) => {
    setText(showAuDate(day));
    commit(day);
    setOpen(false);
    input.current?.focus();
  };

  // Tidied to dd/mm/yyyy once the person moves on.
  const blur = () => {
    const parsed = parseAuDate(text);
    if (parsed) setText(showAuDate(parsed));
  };

  // A form that is reset (cleared after a save) clears the box too, as it would a native one.
  useEffect(() => {
    const f = input.current?.form;
    if (!f || controlled) return;
    const reset = () => {
      const start = defaultValue ?? "";
      lastSent.current = start;
      setIso(start);
      setText(showAuDate(start));
    };
    f.addEventListener("reset", reset);
    return () => f.removeEventListener("reset", reset);
  }, [controlled, defaultValue]);

  // The calendar closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        input.current?.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  // Margins and layout belong to the box as a whole, so the calendar button
  // sits in the middle of the text box; the rest is the text box's own look.
  const classes = className.split(/\s+/).filter(Boolean);
  const outer = classes.filter((c) => /^-?m[trblxy]?-/.test(c) || c === "block" || c === "w-full" || c === "flex-1");
  const inner = classes.filter((c) => !outer.includes(c) || c === "w-full");
  const width = WIDTH.test(inner.join(" ")) ? "" : "w-36";
  const display = outer.includes("block") || outer.includes("w-full") ? "block" : "inline-block";

  return (
    <div ref={wrapper} className={["relative", display, ...outer.filter((c) => c !== "block")].join(" ")}>
      <input
        ref={input}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={DATE_BOX_PLACEHOLDER}
        value={text}
        onChange={(e) => typed(e.target.value)}
        onBlur={blur}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={problem ? true : undefined}
        title={problem ?? undefined}
        className={[...inner, width, "pr-8"].filter(Boolean).join(" ")}
      />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="Choose a date"
        aria-expanded={open}
        aria-controls={open ? calendarId : undefined}
        className="absolute inset-y-0 right-1 my-auto flex h-6 w-6 items-center justify-center rounded text-rc-muted transition hover:text-rc-green-deep disabled:opacity-50"
      >
        <CalendarDays size={15} aria-hidden="true" />
      </button>
      {name && <input type="hidden" name={name} value={iso} form={form} disabled={disabled} />}
      {open && (
        <Calendar id={calendarId} selected={parseAuDate(text) ?? iso} min={min} max={max} onPick={pick} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

function Calendar({
  id,
  selected,
  min,
  max,
  onPick,
  onClose,
}: {
  id: string;
  selected: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const today = sydneyDate();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(selected) ? selected : today;
  const [[year, month], setShown] = useState<[number, number]>([Number(start.slice(0, 4)), Number(start.slice(5, 7))]);
  const [focused, setFocused] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const weeks = monthGrid(year, month);

  // The focused day keeps the keyboard focus as it moves.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused, year, month]);

  const move = (to: string) => {
    setFocused(to);
    const [y, m] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
    if (y !== year || m !== month) setShown([y, m]);
  };

  const keys = (e: ReactKeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      move(addDaysIso(focused, step));
    } else if (e.key === "Tab") {
      onClose();
    }
  };

  return (
    <div
      id={id}
      role="dialog"
      aria-label="Choose a date"
      className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-rc-border bg-white p-2 text-rc-ink shadow-lg"
    >
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShown(shiftMonth(year, month, -1))}
          aria-label="Previous month"
          className="rounded p-1 text-rc-muted hover:bg-rc-bg-alt hover:text-rc-ink"
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <p className="text-sm font-semibold">{formatSydney(`${year}-${String(month).padStart(2, "0")}-01`, { month: "long", year: "numeric" })}</p>
        <button
          type="button"
          onClick={() => setShown(shiftMonth(year, month, 1))}
          aria-label="Next month"
          className="rounded p-1 text-rc-muted hover:bg-rc-bg-alt hover:text-rc-ink"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div ref={grid} role="grid" onKeyDown={keys} className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {WEEKDAYS.map((d) => (
          <span key={d} role="columnheader" className="py-1 text-[11px] font-semibold text-rc-faint">
            {d}
          </span>
        ))}
        {weeks.flat().map((d) => {
          const allowed = inLimits(d.iso, { min, max });
          const isSelected = d.iso === selected;
          const isToday = d.iso === today;
          return (
            <button
              key={d.iso}
              type="button"
              role="gridcell"
              data-day={d.iso}
              tabIndex={d.iso === focused ? 0 : -1}
              disabled={!allowed}
              aria-selected={isSelected}
              aria-label={formatSydney(d.iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              onClick={() => onPick(d.iso)}
              className={`rounded py-1 ${
                isSelected
                  ? "bg-rc-green-deep font-semibold text-white"
                  : isToday
                    ? "font-semibold text-rc-green-deep ring-1 ring-rc-green-deep/40"
                    : d.inMonth
                      ? "text-rc-ink hover:bg-rc-bg-alt"
                      : "text-rc-faint hover:bg-rc-bg-alt"
              } disabled:cursor-not-allowed disabled:opacity-30`}
            >
              {d.day}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          onClick={() => inLimits(today, { min, max }) && onPick(today)}
          disabled={!inLimits(today, { min, max })}
          className="rounded px-2 py-1 text-xs font-semibold text-rc-green-deep hover:underline disabled:opacity-40"
        >
          Today
        </button>
      </div>
    </div>
  );
}
