"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { AlertTriangle, Paperclip, Upload, X } from "lucide-react";
import { MAX_EVIDENCE_BYTES } from "@/lib/storage/evidence";

// A file picker you can also drop a file onto.
//
// Adam, 20 Aug 2026: "can we also have the file upload doable via click and
// drag into the card?"
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO.
//
// 1. It does not upload on drop. Choosing a file and attaching it stay two
//    separate steps, because the failure that made them two steps in the
//    first place is unchanged by how the file arrives: a filename on screen
//    reads as confirmation that something was saved. Adam lost a
//    comparable-sales report that way on 14 Aug 2026 and believed it was on
//    file for days. Dropping a file feels more decisive than picking one,
//    which if anything makes the false confirmation MORE convincing. The
//    caller still renders the amber "not attached yet" gate.
//
// 2. It does not accept a folder or a multi-file drop silently. Dropping
//    three files and having two vanish without a word is the same class of
//    bug — the agent believes they attached something they didn't. It takes
//    the first file and says so.
//
// SIZE IS CHECKED HERE, AT THE MOMENT THE FILE IS CHOSEN.
//
// It used to be checked inside uploadEvidenceObject, which only runs once the
// form has been submitted. On the Add a listing page that meant an oversized
// file sat there looking accepted, and pressing Create listing appeared to do
// nothing: the message rendered in a banner at the top of a long form, off
// screen, with no scroll to it. Reported on 12/1 Werombi Road, 22 Aug 2026.
// A limit you can only discover by failing is a limit in the wrong place, so
// the file is now refused on the spot, against the field it belongs to. The
// check inside uploadEvidenceObject stays where it is: this one is the
// courtesy, that one is the guard.
export function FileDropZone({
  name,
  file,
  onFile,
  disabled,
  label = "Drag a file here, or click to browse",
  compact = false,
  required = false,
  maxBytes = MAX_EVIDENCE_BYTES,
}: {
  /** Form field name. Omit for zones driven purely by the onFile callback. */
  name?: string;
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
  label?: string;
  /** Tighter padding, for the evidence row inside a compliance card. */
  compact?: boolean;
  /**
   * Marks the field as needed, for the caller's own validation and for
   * screen readers. Deliberately NOT wired to the input's `required`
   * attribute: the input is visually hidden, and Chrome refuses to submit a
   * form containing an invalid control it cannot show a bubble against —
   * silently, with nothing on screen to explain why the button did nothing.
   * Every caller validates in JS and renders a real message instead.
   */
  required?: boolean;
  /** Largest file this zone will accept. Defaults to the storage limit. */
  maxBytes?: number;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [tookFirst, setTookFirst] = useState(false);
  const [tooBig, setTooBig] = useState<string | null>(null);
  // dragenter/dragleave fire for every child element the cursor crosses, so a
  // naive boolean flickers as the pointer moves over the label text inside the
  // zone. Counting enters against leaves is the standard fix.
  const depth = useRef(0);

  // A file dropped a few pixels outside the zone would otherwise be opened by
  // the browser, replacing the page — and with it any unsaved note, ESP figure
  // or half-finished form on the listing. A near-miss should do nothing at
  // all, so the whole document swallows stray drops while this zone exists.
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  function take(list: FileList | null) {
    const dropped = Array.from(list ?? []);
    if (dropped.length === 0) return;
    const chosen = dropped[0];

    if (chosen.size > maxBytes) {
      // Refused, and nothing kept. Holding on to it and greying the button
      // would put us back where we started: a file on screen that is not
      // going anywhere, and a form that will not move.
      setTookFirst(false);
      setTooBig(`${chosen.name} is ${formatBytes(chosen.size)}. The limit is ${formatBytes(maxBytes)}.`);
      onFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setTooBig(null);
    setTookFirst(dropped.length > 1);
    onFile(chosen);
    // Keep the real input in step, so a plain (non-JS) form submit still
    // carries the file and the browser's own validation sees it.
    if (inputRef.current && list) {
      const dt = new DataTransfer();
      dt.items.add(chosen);
      inputRef.current.files = dt.files;
    }
  }

  // Clearing the input's value as well as the state matters: without it,
  // choosing the same file again after removing it fires no change event at
  // all, and the zone stays stubbornly empty for no visible reason.
  function clear() {
    setTooBig(null);
    setTookFirst(false);
    onFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    take(e.dataTransfer.files);
  }

  const border = over
    ? "border-rc-green-deep bg-rc-green-soft"
    : tooBig
      ? "border-rc-amber-deep/40 bg-rc-amber/10"
      : file
        ? "border-rc-border bg-white"
        : "border-rc-border bg-rc-bg-alt hover:border-rc-green-deep hover:bg-white";

  return (
    <div>
      {/* The drag target is this div, not the label, so the Remove button can
          sit inside the dashed box without being swallowed by the label's own
          click-to-open-the-picker behaviour. */}
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current += 1;
          if (!disabled) setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          depth.current -= 1;
          if (depth.current <= 0) setOver(false);
        }}
        onDrop={handleDrop}
        className={`flex items-center gap-2.5 rounded-lg border border-dashed transition ${border} ${
          compact ? "px-3 py-2.5" : "px-3 py-4"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <label
          htmlFor={inputId}
          className={`flex min-w-0 flex-1 items-center gap-2.5 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          {file ? (
            <Paperclip size={compact ? 14 : 16} className="shrink-0 text-rc-green-deep" />
          ) : (
            <Upload size={compact ? 14 : 16} className="shrink-0 text-rc-muted" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-rc-ink">{file ? file.name : label}</span>
            {file && (
              <span className="block text-[11px] text-rc-faint">
                {formatBytes(file.size)} · click to replace
              </span>
            )}
          </span>
        </label>
        {/* Dropping a new file over the old one already replaced it, but only
            someone who had already worked that out would ever try. Reported
            22 Aug 2026: once a file was on, there was no visible way off it. */}
        {file && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label={`Remove ${file.name}`}
            title="Remove"
            className="shrink-0 rounded-md p-1 text-rc-faint transition hover:bg-rc-amber/10 hover:text-rc-amber-deep focus:outline-none focus:ring-2 focus:ring-rc-green-soft"
          >
            <X size={compact ? 13 : 15} />
          </button>
        )}
        <input
          id={inputId}
          ref={inputRef}
          name={name}
          type="file"
          aria-required={required || undefined}
          disabled={disabled}
          onChange={(e) => take(e.target.files)}
          className="sr-only"
        />
      </div>
      {tooBig && (
        <p
          role="alert"
          className="mt-1 flex items-start gap-1.5 text-[11px] font-medium leading-relaxed text-rc-amber-deep"
        >
          <AlertTriangle size={12} className="mt-px shrink-0" />
          <span>{tooBig} Nothing was attached. Try a smaller copy, or split it.</span>
        </p>
      )}
      {tookFirst && file && (
        <p className="mt-1 text-[11px] text-rc-muted">
          More than one file was dropped, so this one was used: <strong>{file.name}</strong>. Attach the others one
          at a time.
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  // 20 MB, not 20.0 MB. The limit is a round number and should read like one.
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
