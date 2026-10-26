"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { gotItHomeNotice } from "@/lib/actions/home-notices";

/**
 * A Home card shown once (0096). The first time it is on screen, that is
 * recorded, so the next visit shows the small line instead. "Got it" records
 * it and hides the card now; if that can't be recorded (before 0096 is run)
 * the card still goes for this visit.
 *
 * The first view is recorded from the browser, not by a server action: a
 * server action that touches the sign-in cookies makes Next.js draw the page
 * again at once, and the card would vanish the moment it appeared.
 */
export function useHomeNotice(noticeKey: string | null) {
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const noted = useRef<string | null>(null);

  useEffect(() => {
    if (!noticeKey || noted.current === noticeKey) return;
    noted.current = noticeKey;
    void createClient()
      .rpc("note_home_notice", { p_key: noticeKey, p_dismiss: false })
      .then(
        () => undefined,
        () => undefined,
      );
  }, [noticeKey]);

  function gotIt() {
    if (!noticeKey) return;
    startTransition(async () => {
      setHidden(true);
      await gotItHomeNotice(noticeKey).catch(() => undefined);
    });
  }

  return { hidden, pending, gotIt };
}
