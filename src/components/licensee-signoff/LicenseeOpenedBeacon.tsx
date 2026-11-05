"use client";

import { useEffect } from "react";
import { noteLicenseeLinkOpened } from "@/lib/actions/licensee-signoff";

// "Opened" only when a person interacts with the page (the email job's rule,
// 0107): never a security scanner's fetch. Renders nothing.
const EVENTS = ["pointermove", "pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;

export function LicenseeOpenedBeacon({ token }: { token: string }) {
  useEffect(() => {
    let sent = false;
    const onActivity = () => {
      if (sent || document.visibilityState !== "visible") return;
      sent = true;
      for (const e of EVENTS) window.removeEventListener(e, onActivity, true);
      void noteLicenseeLinkOpened(token);
    };
    for (const e of EVENTS) window.addEventListener(e, onActivity, { capture: true, passive: true });
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, onActivity, true);
    };
  }, [token]);
  return null;
}
