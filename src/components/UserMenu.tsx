"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ClipboardCheck, KeyRound, LogOut } from "lucide-react";
import { logout } from "@/lib/actions/auth";

// Who you are, and the way out.
//
// Sign out used to be a permanent button in the chrome. Moving it under the
// avatar is where people look for it, and it frees the width that global
// search now uses (Adam, 24 Aug 2026, on the shell mock-up). The identity
// itself stays visible on desktop — Adam, 13 Aug 2026: "your name and role
// stay put" — so this menu is the actions, not the identity.
//
// Nothing invented sits in here. Every entry goes somewhere that already
// exists; a menu of plausible-looking dead links is worse than a short one.
export function UserMenu({
  name,
  role,
  isLicensee,
  initial,
}: {
  name: string;
  role: string;
  isLicensee: boolean;
  initial: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Your account"
        className="flex items-center gap-2 rounded-full p-0.5 pr-1.5 transition hover:bg-rc-bg-alt"
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]"
          style={{ background: "linear-gradient(155deg, #1d3a31 0%, #0d1f19 100%)" }}
          aria-hidden="true"
        >
          {initial}
        </span>
        <ChevronDown size={13} strokeWidth={2.4} className="text-rc-faint" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 rounded-2xl border border-rc-border bg-white p-1.5 shadow-card"
        >
          <div className="border-b border-rc-border px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-semibold text-rc-ink">{name}</p>
            <p className={`text-xs font-medium ${isLicensee ? "text-rc-green-deep" : "text-rc-muted"}`}>{role}</p>
          </div>

          <Link
            href="/dashboard/cpd"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mt-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink"
          >
            <ClipboardCheck size={15} aria-hidden="true" /> Your CPD record
          </Link>

          <Link
            href="/dashboard/password"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink"
          >
            <KeyRound size={15} aria-hidden="true" /> Change password
          </Link>

          <form action={logout}>
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium text-rc-muted transition hover:bg-rc-bg-alt hover:text-rc-ink"
            >
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
