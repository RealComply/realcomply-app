"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { MAX_EVIDENCE_BYTES } from "@/lib/storage/evidence";

// Drag-and-drop for any upload control, not just the ones built as a drop zone.
//
// Adam, 9 Sep 2026: "I can't drag my SG to be uploaded in RC — can we make
// sure anytime there is an option to upload a doc, the click and drag feature
// is active?"
//
// He is right, and the gap was invisible from the code. FileDropZone was built
// on 20 Aug for exactly this and five upload points use it; three never got it
// — the Supervision Guidelines Manual, a staff licence or certificate, and a
// CPD certificate. Each of those three is a bare hidden <input type="file">
// behind a label. Two of them are drawn with a DASHED BORDER, which is the
// universal sign for "drop a file here", so they actively invited the thing
// they could not do.
//
// THE PART THAT WAS WORSE THAN NOT WORKING. A browser's default action for a
// file dropped on a page is to navigate to it — the page is replaced by the
// document. FileDropZone already swallowed stray drops, but only while one was
// mounted, and none is mounted on the SG Manual page. So dropping a file there
// did not merely fail: it threw the page away. On a page carrying an unsaved
// note or a half-filled form that is real lost work. StrayDropGuard now does
// that swallowing for the whole dashboard, so a miss is always a no-op.
//
// WHY A HOOK RATHER THAN CONVERTING ALL THREE TO FileDropZone. One of them is
// a full card and did convert. The other two upload the moment a file is
// chosen and are drawn as a single line of text or a small tile — wrapping
// them in a bordered drop zone would restyle two registers to fix a drag
// handler. This gives them the same drag behaviour with their own appearance,
// and one implementation to fix if it is ever wrong.

export type FileDropState = {
  /** Spread onto the element that should accept a drop. */
  dragProps: {
    onDragEnter: (e: DragEvent<HTMLElement>) => void;
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
  /** True while a file is over the element, for the highlight. */
  isOver: boolean;
  /** Set when a dropped file was refused. Null once a good one arrives. */
  dropError: string | null;
  /** True when more than one file was dropped and only the first was taken. */
  tookFirstOnly: boolean;
  /** Clears the refusal message — call when the caller resets. */
  clearDropError: () => void;
};

export function useFileDrop({
  onFile,
  disabled = false,
  maxBytes = MAX_EVIDENCE_BYTES,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  maxBytes?: number;
}): FileDropState {
  const [isOver, setIsOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [tookFirstOnly, setTookFirstOnly] = useState(false);
  // dragenter and dragleave fire for every child the cursor crosses, so a plain
  // boolean flickers as the pointer moves over text inside the target.
  // Counting enters against leaves is the standard fix.
  const depth = useRef(0);

  return {
    isOver,
    dropError,
    tookFirstOnly,
    clearDropError: () => setDropError(null),
    dragProps: {
      onDragEnter: (e) => {
        e.preventDefault();
        depth.current += 1;
        if (!disabled) setIsOver(true);
      },
      onDragOver: (e) => e.preventDefault(),
      onDragLeave: (e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) setIsOver(false);
      },
      onDrop: (e) => {
        e.preventDefault();
        depth.current = 0;
        setIsOver(false);
        if (disabled) return;

        const dropped = Array.from(e.dataTransfer?.files ?? []);
        if (dropped.length === 0) return;
        const chosen = dropped[0];

        // Same rule as FileDropZone: refuse on the spot rather than at submit,
        // and never keep a file that is not going anywhere.
        if (chosen.size > maxBytes) {
          setTookFirstOnly(false);
          setDropError(
            `${chosen.name} is ${formatBytes(chosen.size)}. The limit is ${formatBytes(maxBytes)}. Nothing was attached.`,
          );
          return;
        }

        // A silent multi-file drop is the same class of bug as a silent
        // failure — the person believes they attached three things.
        setDropError(null);
        setTookFirstOnly(dropped.length > 1);
        onFile(chosen);
      },
    },
  };
}

/**
 * Swallows file drops that miss an upload control.
 *
 * Mounted once in the dashboard layout. Without it the browser navigates to
 * the dropped file and the page — with anything unsaved on it — is gone.
 */
export function useStrayDropGuard(): void {
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
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  // 20 MB, not 20.0 MB. The limit is a round number and should read like one.
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
