"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  FileText,
  ClipboardCheck,
  GraduationCap,
  Home,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Users,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/Logo";

// Left sidebar navigation, replacing the seven-link top bar (TopNav) that had
// outgrown its row and scrolled sideways on smaller screens.
//
// Two things drove the change. First, vertical space is cheap: every new
// destination now has an obvious home instead of competing for horizontal
// room. Second, each row has space for a count badge — the point being that
// an open breach or an outstanding sign-off becomes visible from any page,
// not only once you've navigated to the register that holds it. The badges
// themselves are a follow-up (they need counts plumbed through the layout);
// the structure is here so adding them is a data change, not a redesign.
//
// The grouping is the part worth revisiting if it ever feels wrong: "Your
// work" is the daily view, "Compliance records" is the evidence you would
// hand a regulator, "Agency" is setup that changes rarely. Registers /
// Training / Sign-offs sitting together was the judgement call — Adam
// reviewed and kept it, 13 Aug 2026.
//
// Colour: --rc-nav-bg (Forest, #24453a). See globals.css for why the ladder
// stops at that shade rather than going lighter.
//
// COLLAPSING is deliberately not React state. The `data-rail-*` attributes
// below are hooks for the CSS in globals.css, which keys off a `rc-nav-rail`
// class on <html>; the toggle sets that class and an inline script in the
// root layout restores it before first paint. The reasoning is written up
// beside those CSS rules — short version: the collapsed width is consumed by
// a grid template in the server-rendered layout, and doing it in state costs
// either a visible flash or a hydration mismatch. One consequence worth
// knowing: because the rail rules are scoped to the md breakpoint, the same
// markup renders labelled in the mobile drawer with no extra branching.

const STORAGE_KEY = "rc-sidebar-collapsed";
const RAIL_CLASS = "rc-nav-rail";

type NavLink = { href: string; label: string; Icon: typeof Home };

const GROUPS: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Your work",
    links: [
      { href: "/dashboard/home", label: "Home", Icon: Home },
      { href: "/dashboard/portfolio", label: "Office overview", Icon: LayoutGrid },
    ],
  },
  {
    heading: "Compliance records",
    links: [
      { href: "/dashboard/registers", label: "Registers", Icon: FileText },
      { href: "/dashboard/training", label: "Training log", Icon: GraduationCap },
      // Separate from the log on purpose — the log is evidence of what
      // happened, this is the forward plan Requirement 2.4 actually asks for.
      { href: "/dashboard/training-plans", label: "Training plans", Icon: ClipboardCheck },
      { href: "/dashboard/document-signoffs", label: "Sign-offs", Icon: PenLine },
    ],
  },
  {
    heading: "Agency",
    links: [
      { href: "/dashboard/sg-manual", label: "SG Manual", Icon: BookOpen },
      { href: "/dashboard/team", label: "Team", Icon: Users },
    ],
  },
];

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function toggleRail(button: HTMLButtonElement) {
  const railed = document.documentElement.classList.toggle(RAIL_CLASS);
  button.setAttribute("aria-pressed", String(railed));
  try {
    window.localStorage.setItem(STORAGE_KEY, railed ? "1" : "0");
  } catch {
    // Private browsing or blocked storage — not remembering the choice is not
    // worth failing over.
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Escape closes the mobile drawer, matching what a keyboard user expects of
  // any overlay. No-op on desktop, where the drawer is never open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // One markup tree serves both the desktop column and the mobile drawer.
  const panel = (
    <div data-rail-pad className="flex h-full flex-col gap-1 bg-rc-nav-bg px-3 py-5">
      <Link
        href="/dashboard/home"
        onClick={() => setOpen(false)}
        data-rail-center
        className="flex items-center gap-2.5 px-2.5 pb-5 pt-0.5"
      >
        {/* LogoMark, not Logo. Logo bundles the mark WITH a "RealComply"
            wordmark in text-rc-ink — near-invisible on this surface, and it
            rendered a second time underneath the white one below, which is
            exactly what it looked like in production. variant="dark" is the
            lifted fill the mark already provides for ink surfaces. */}
        <LogoMark size={26} variant="dark" />
        <span
          data-rail-hide
          className="whitespace-nowrap text-[17px] font-extrabold tracking-tight text-white"
        >
          Real<span className="text-rc-green">Comply</span>
        </span>
      </Link>

      {GROUPS.map((group, gi) => (
        <div key={group.heading}>
          {gi > 0 && <div data-rail-divider className="mx-2 my-2.5 border-t border-rc-ink-line" />}
          <div
            data-rail-hide
            className={`whitespace-nowrap px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-rc-nav-muted ${
              gi === 0 ? "mt-0.5" : "mt-4"
            }`}
          >
            {group.heading}
          </div>
          {group.links.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                // Closes the drawer on tap. Handling it here rather than in an
                // effect watching the pathname keeps the state change in the
                // event that caused it, and avoids the drawer sitting open
                // over the page you just chose when you pick the current one.
                onClick={() => setOpen(false)}
                title={label}
                aria-current={active ? "page" : undefined}
                data-rail-center
                className={`flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-sm transition ${
                  active
                    ? "bg-rc-green-deep font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.09)_inset]"
                    : "font-medium text-rc-ink-muted hover:bg-white/[0.06] hover:text-white"
                }`}
              >
                <Icon size={16} strokeWidth={2} className="shrink-0" aria-hidden="true" />
                <span data-rail-hide className="whitespace-nowrap">
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      ))}

      {/* The standing liability line, settled with Adam on 15 Aug 2026 after
          working through a dozen drafts. It replaces "Diligence support — the
          licensee decides."

          Two rules govern any future edit, both learned from the drafts that
          were rejected:

          1. NEVER address the reader as "you" about sign-off. Salespeople see
             this sidebar as well as the licensee, and "the work you sign off"
             tells an agent they hold a sign-off that is actually the licensee
             in charge's. The product's own words would then undercut the
             supervision structure they exist to protect.
          2. NEVER use an advisory verb. "We guide, you decide" was the
             tempting version; "guide" implies advice, and not giving advice is
             the whole defensive posture. Same reason there is no "we" here:
             the software keeps a record, it is not a party giving counsel.

          The second sentence is the liability framing, not decoration. It
          stays. */}
      <p
        data-rail-hide
        className="mt-auto border-t border-rc-ink-line px-3 pt-3.5 text-[11px] leading-relaxed text-rc-nav-muted"
      >
        Supports the work. The licensee signs off.
      </p>
    </div>
  );

  return (
    <>
      {/* Desktop: a real column in the layout grid, with the width control
          pinned to its bottom edge. */}
      {/* The control sits in normal flow beneath the panel rather than
          absolutely positioned over it — as an overlay it landed on top of
          the "Diligence support" line, which is what shipped. A flex column
          with the panel taking the free space keeps them apart at any
          height. */}
      {/* Pinned to the viewport. It was an ordinary column in the page grid,
          so it scrolled away with everything else and navigation vanished the
          moment you went down a long property file (Adam, 14 Aug 2026) —
          exactly where you most want to jump somewhere else. sticky rather
          than fixed keeps it inside the grid, so the column still gets its
          width from --rc-sidebar-w and the collapse toggle keeps working; a
          fixed element would leave the grid holding an empty track. h-screen
          bounds it to the viewport, and the panel below scrolls inside that if
          the list ever outgrows the height. */}
      <aside className="rc-app-chrome hidden self-start bg-rc-nav-bg md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
        <button
          type="button"
          onClick={(e) => toggleRail(e.currentTarget)}
          title="Collapse or expand the sidebar"
          aria-label="Collapse or expand the sidebar"
          aria-pressed="false"
          data-rail-center
          className="mx-3 mb-4 mt-1 flex h-8 items-center gap-2 rounded-lg px-3 text-rc-nav-muted transition hover:bg-white/[0.06] hover:text-white"
        >
          <PanelLeftClose data-expanded-only size={16} aria-hidden="true" />
          <PanelLeftOpen data-rail-only size={16} aria-hidden="true" />
          <span data-rail-hide className="whitespace-nowrap text-[12.5px] font-medium">
            Collapse
          </span>
        </button>
      </aside>

      {/* Mobile: a button over the content, and the same panel as a drawer.
          Always labelled — the rail is a desktop affordance only. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="rc-app-chrome fixed left-3 top-3 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-rc-nav-bg text-white shadow-md md:hidden"
      >
        <Menu size={18} aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-rc-ink/50"
          />
          <div className="absolute inset-y-0 left-0 w-[248px] shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close navigation"
              className="absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-rc-ink-muted hover:bg-white/10 hover:text-white"
            >
              <X size={16} aria-hidden="true" />
            </button>
            {panel}
          </div>
        </div>
      )}
    </>
  );
}
