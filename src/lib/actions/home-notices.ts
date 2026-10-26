"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Records that the signed-in person has seen an office manager card on Home,
// and when they pressed "Got it" (0096; Adam, 26 Oct 2026). The database
// checks the card is about their own office; the record is theirs alone.

const NOTICE_KEY = /^om-(approved|withdrawn):[0-9a-f-]{36}$/;

/** The card was on their Home. Changes nothing on screen: the next visit shows the small line. */
export async function noteHomeNoticeSeen(key: string): Promise<void> {
  if (!NOTICE_KEY.test(key)) return;
  const supabase = await createClient();
  await supabase.rpc("note_home_notice", { p_key: key, p_dismiss: false });
}

/** "Got it": recorded, then Home is drawn again with the small line in place of the card. */
export async function gotItHomeNotice(key: string): Promise<{ ok: boolean }> {
  if (!NOTICE_KEY.test(key)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc("note_home_notice", { p_key: key, p_dismiss: true });
  if (error) return { ok: false };
  refresh();
  return { ok: true };
}
