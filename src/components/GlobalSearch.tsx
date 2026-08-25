"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Building2, Search, User, X } from "lucide-react";
import { NAV_LINKS, type NavLink } from "@/lib/nav";
import type { SearchHit } from "@/app/api/search/route";

// Global search — the one convention every CRM examined shares and this app
// did not have (see RealComply-CRM-interface-conventions.md). Agents navigate
// by typing an address, not by clicking through a tree.
//
// TWO SOURCES, DELIBERATELY DIFFERENT.
//
//   Pages come from NAV_LINKS and are matched here, in the browser. There are
//   nine of them, they never change between renders, and asking a server where
//   the Gift register lives would be absurd.
//
//   Listings and people come from /api/search, because they are data, they are
//   scoped by RLS, and there can be hundreds.
//
// Pages are listed FIRST when they match. Someone typing "gifts" wants the
// register; someone typing an address wants the file. Ranking pages above data
// costs the address search nothing, because an address never matches a page.

type Row = { key: string; title: string; subtitle: string; href: string; icon: "page" | "listing" | "person" };

const DEBOUNCE_MS = 180;

function matchesPage(link: NavLink, term: string): boolean {
  const haystack = [link.label, ...(link.keywords ?? [])].join(" ").toLowerCase();
  return haystack.includes(term);
}

export function GlobalSearch({ isAssistant = false }: { isAssistant?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const pages = isAssistant ? NAV_LINKS.filter((l) => l.assistantSees) : NAV_LINKS;
  const trimmed = term.trim().toLowerCase();

  const rows: Row[] = [
    ...(trimmed.length > 0
      ? pages.filter((l) => matchesPage(l, trimmed)).map((l) => ({
          key: `page:${l.href}`,
          title: l.label,
          subtitle: "Page",
          href: l.href,
          icon: "page" as const,
        }))
      : []),
    ...hits.map((h) => ({
      key: `${h.kind}:${h.id}`,
      title: h.title,
      subtitle: h.subtitle,
      href: h.href,
      icon: h.kind === "listing" ? ("listing" as const) : ("person" as const),
    })),
  ];

  // Everything that reacts to typing happens HERE, in the event, rather than
  // in an effect watching `term`. Resetting the highlight and clearing stale
  // results are consequences of the keystroke, not of some external system
  // changing — and setState inside an effect body causes cascading renders
  // (react-hooks/set-state-in-effect).
  function onTermChange(value: string) {
    setTerm(value);
    setCursor(0);
    if (value.trim().length < 2) {
      setHits([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  // The effect is left doing only what an effect is for: talking to something
  // outside React. Every setState below sits inside an async callback, not in
  // the body. Aborting on cleanup stops a slow early keystroke landing after a
  // fast later one and overwriting it.
  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < 2) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((data: { hits?: SearchHit[] }) => setHits(data.hits ?? []))
        .catch(() => {
          // An aborted request is the normal case here, not a failure.
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term, open]);

  const close = useCallback(() => {
    setOpen(false);
    setTerm("");
    setHits([]);
    setCursor(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  // Cmd/Ctrl-K from anywhere, matching what the rest of the category does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function onFieldKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (rows.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) go(row.href);
    }
  }

  return (
    <>
      {/* A circular icon button, not a labelled field (Adam, 25 Aug 2026:
          "it needs to be a magnifying glass icon in a small circle").
          Same place in the bar — only the shape changed.

          The trade-off, stated rather than buried: an icon on its own is less
          discoverable than a field that says "Search a listing, a person, a
          page". What buys that back is that the magnifying glass is close to a
          universal symbol, the circle matches the avatar beside it so it reads
          as a control rather than decoration, and the tooltip carries both the
          word and the shortcut for anyone who hovers. If agents turn out not to
          find it, the fix is a label on this one — not a second search
          somewhere else. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        title="Search — ⌘K"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rc-border bg-white text-rc-muted transition hover:border-rc-ink/15 hover:text-rc-ink hover:shadow-[0_1px_3px_rgba(13,31,25,0.06)]"
      >
        <Search size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>

      {/* PORTALLED TO document.body, and it has to be.
          
          The bug this fixes (Adam, 25 Aug 2026: "the magnifying glass... the
          header is blanking out"): this panel is rendered by a component that
          lives inside the top bar, and the top bar carries `backdrop-blur-md`.
          An element with a backdrop-filter becomes the CONTAINING BLOCK for its
          position:fixed descendants — the same rule that applies to transform
          and filter. So `fixed inset-0` stopped meaning "the viewport" and
          started meaning "the header", and the dark scrim painted itself over
          the header alone. It looked like the header was blanking out because
          that is exactly what was happening.
          
          A portal moves the panel out of the header's subtree entirely, so
          inset-0 resolves against the viewport again. Safe without a mounted
          guard because it only renders when `open` is true, which cannot
          happen during server rendering. */}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex justify-center bg-rc-ink/40 px-4 pt-[12vh] backdrop-blur-[2px]"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Search"
              className="flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(13,31,25,0.3)]"
            >
              <div className="flex items-center gap-2.5 border-b border-rc-border px-4 py-3.5">
                <Search size={17} strokeWidth={2.2} className="shrink-0 text-rc-faint" aria-hidden="true" />
                <input
                  ref={inputRef}
                  value={term}
                  onChange={(e) => onTermChange(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                  placeholder="Address, name, or what you're looking for"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-[15px] text-rc-ink outline-none placeholder:text-rc-faint"
                />
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close search"
                  className="shrink-0 rounded-lg p-1 text-rc-faint transition hover:bg-rc-bg-alt hover:text-rc-ink"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {rows.length > 0 ? (
                  rows.map((row, i) => (
                    <button
                      key={row.key}
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(row.href)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                        i === cursor ? "bg-rc-green-soft" : "hover:bg-rc-bg-alt"
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rc-bg-alt text-rc-green-deep">
                        {row.icon === "listing" ? (
                          <Building2 size={15} aria-hidden="true" />
                        ) : row.icon === "person" ? (
                          <User size={15} aria-hidden="true" />
                        ) : (
                          <Search size={15} aria-hidden="true" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-rc-ink">{row.title}</span>
                        <span className="block truncate text-xs text-rc-muted">{row.subtitle}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="px-4 py-8 text-center text-sm text-rc-faint">
                    {term.trim().length < 2
                      ? "Start typing — an address, someone's name, or a page."
                      : loading
                        ? "Looking…"
                        : `Nothing matches “${term.trim()}”.`}
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
