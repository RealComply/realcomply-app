"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { Paperclip, Upload } from "lucide-react";

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
export function FileDropZone({
  name,
  file,
  onFile,
  disabled,
  label = "Drag a file here, or click to browse",
  compact = false,
  required = false,
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
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [tookFirst, setTookFirst] = useState(false);
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
    setTookFirst(dropped.length > 1);
    onFile(dropped[0]);
    // Keep the real input in step, so a plain (non-JS) form submit still
    // carries the file and the browser's own validation sees it.
    if (inputRef.current && list) {
      const dt = new DataTransfer();
      dt.items.add(dropped[0]);
      inputRef.current.files = dt.files;
    }
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    take(e.dataTransfer.files);
  }

  const border = over
    ? "border-rc-green-deep bg-rc-green-soft"
    : file
      ? "border-rc-border bg-white"
      : "border-rc-border bg-rc-bg-alt hover:border-rc-green-deep hover:bg-white";

  return (
    <div>
      <label
        htmlFor={inputId}
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
        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed transition ${border} ${
          compact ? "px-3 py-2.5" : "px-3 py-4"
        } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
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
              {formatBytes(file.size)} — click to choose a different file
            </span>
          )}
        </span>
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
      </label>
      {tookFirst && file && (
        <p className="mt-1 text-[11px] text-rc-muted">
          More than one file was dropped — using <strong>{file.name}</strong>. Attach the others one at a time.
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
