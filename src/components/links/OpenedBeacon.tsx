"use client";

import { useEffect } from "react";
import { noteLinkOpened } from "@/lib/actions/link-delivery";
import type { LinkKind } from "@/lib/links/delivery";

// "Opened" means a real person opened the link in a browser (Adam, 2 Nov
// 2026; 0107). Email security scanners fetch links, and some run the page's
// script, but they don't scroll, tap, move a mouse or type. So the open is
// reported on the first of those, while the page is showing, and once only.
// Renders nothing.

const EVENTS = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;

export function OpenedBeacon({ kind, token }: { kind: LinkKind; token: string }) {
  useEffect(() => {
    let sent = false;
    const onActivity = () => {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      for (const e of EVENTS) window.removeEventListener(e, onActivity, true);
      void noteLinkOpened(kind, token);
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { capture: true, passive: true });
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, true);
    };
  }, [kind, token]);
  return null;
}
