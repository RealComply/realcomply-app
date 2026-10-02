"use client";

import { useEffect } from "react";

// Renders nothing. Publishes the user bar's real height as --rc-userbar-h on
// <html>, so anything else that sticks to the top of the page (the property
// header, 3 Oct 2026) can sit directly under the bar instead of sliding
// behind it. Measured rather than hard-coded because the bar's height
// changes with screen width — the name block only shows at desktop widths.
export function UserBarHeight({ targetId }: { targetId: string }) {
  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--rc-userbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [targetId]);
  return null;
}
