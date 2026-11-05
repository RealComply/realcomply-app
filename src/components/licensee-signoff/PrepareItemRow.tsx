"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveItemNote, type PackActionState } from "@/lib/actions/licensee-signoff";

// One item in the pack being prepared (Adam, 3 Nov 2026; the approved mockup,
// view 1): what it is, who and when, its flag in amber, Open, and Note. The
// office manager's note goes into the pack and the licensee sees it.
export type PrepareItem = {
  type: string;
  id: string;
  title: string;
  details: string;
  flagged: boolean;
  flagText: string | null;
  note: string | null;
  noteBy: string | null;
  heldBackNote: string | null;
  href: string;
  openLabel: string;
};

export function PrepareItemRow({ item, canNote }: { item: PrepareItem; canNote: boolean }) {
  const [state, action, pending] = useActionState<PackActionState, FormData>(saveItemNote.bind(null, item.type, item.id), {
    error: null,
  });
  const [editing, setEditing] = useState(false);
  const [flag, ...why] = (item.flagText ?? "").split(":");
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${item.flagged ? "border-rc-amber/40 bg-rc-amber/10" : "border-rc-border bg-rc-bg-alt"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rc-ink">
            {item.title}
            {item.flagText && (
              <span className="ml-2 rounded-full border border-rc-amber/40 bg-rc-amber/10 px-2 py-0.5 text-[11px] font-bold text-rc-amber-deep">
                {flag}
              </span>
            )}
          </p>
          <p className="text-xs text-rc-muted">
            {item.details}
            {why.length > 0 ? ` · ${why.join(":").trim()}` : ""}
          </p>
          {item.heldBackNote && <p className="mt-1 text-xs text-rc-amber-deep">Held back last time: &ldquo;{item.heldBackNote}&rdquo;</p>}
          {item.note && !editing && (
            <p className="mt-1 rounded border-l-[3px] border-rc-green-deep bg-white px-2 py-1 text-xs text-rc-ink">
              {item.noteBy ? `${item.noteBy}: ` : ""}
              {item.note}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-sm font-semibold">
          <Link href={item.href} className="text-rc-green-deep hover:underline">
            {item.openLabel}
          </Link>
          {canNote && (
            <button type="button" onClick={() => setEditing((e) => !e)} className="text-rc-green-deep hover:underline">
              Note
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form
          action={async (fd) => {
            await action(fd);
            setEditing(false);
          }}
          className="mt-2 flex flex-wrap items-center gap-2"
        >
          <label className="sr-only" htmlFor={`note-${item.id}`}>
            Note for the licensee
          </label>
          <input
            id={`note-${item.id}`}
            name="note"
            defaultValue={item.note ?? ""}
            maxLength={1000}
            placeholder="A note the licensee will see"
            className="min-w-0 flex-1 rounded-lg border border-rc-border px-3 py-1.5 text-sm"
          />
          <button type="submit" disabled={pending} className="rounded-full bg-rc-green-deep px-3 py-1.5 text-xs font-semibold text-white">
            Save note
          </button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-rc-muted underline">
            Cancel
          </button>
        </form>
      )}
      {state.error && (
        <p role="alert" className="mt-1 text-xs text-rc-amber-deep">
          {state.error}
        </p>
      )}
    </li>
  );
}
