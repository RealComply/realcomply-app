"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

// Makes an entire card navigate to `href` on click — not just the small
// "View →" corner link — matching the whole-card hover affordance
// (WidgetCard/StatTile lift + shadow on :hover) that was otherwise
// promising more than it delivered: the card looked clickable everywhere
// but only that one small link actually worked (Adam, 9 Aug 2026).
//
// Clicks landing on or inside a real <a>/<button> (e.g. the per-property
// rows in NeedsAttentionWidget) are left alone to do their own thing —
// this only fires for clicks on the card's "dead space". Keyboard-
// accessible (Enter/Space) since the card itself is a div, not a real link.
export function ClickableCard({
  href,
  className,
  children,
}: {
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  if (!href) {
    return <div className={className}>{children}</div>;
  }

  function go(e: MouseEvent | KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.closest("a, button")) return;
    router.push(href!);
  }

  return (
    <div
      className={`${className ?? ""} cursor-pointer`}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go(e);
        }
      }}
      role="link"
      tabIndex={0}
    >
      {children}
    </div>
  );
}
