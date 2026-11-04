"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { createServiceClient } from "@/lib/supabase/service";
import { createPack, draftItems, draftMonth, packsFor, signPack } from "@/lib/licensee-signoff/pack";
import { emailPack, officeFor } from "@/lib/licensee-signoff/server";
import { monthName } from "@/lib/licensee-signoff/model";

// The licensee's sign-off (Adam, 3 Nov 2026; 0109): the month's pack, signed
// in the app by the licensee in charge. Who may do what is checked here; the
// writes go through the database's own functions (0109) with the server's
// key. A licensee with no login has no pack yet (Master, 4 Nov 2026: their
// links are a separate change), so their files keep going to them by email.

export type PackActionState = { error: string | null; done?: string | null };

const PAGE = "/dashboard/licensee-signoff";
const ITEM_TYPES = new Set(["sales_file", "trust_reconciliation", "trust_audit", "sg_manual", "training_plan", "complaint", "gift"]);
const nameOf = (p: { full_name: string | null; email: string | null }) => (p.full_name ?? "").trim() || p.email || "Someone";

function holdsFrom(formData: FormData): Array<{ id: string; note: string }> {
  try {
    const raw = JSON.parse(String(formData.get("holds") ?? "[]")) as Array<{ id?: unknown; note?: unknown }>;
    return raw
      .filter((h) => typeof h.id === "string" && /^[0-9a-f-]{36}$/i.test(h.id))
      .map((h) => ({ id: h.id as string, note: String(h.note ?? "").trim().slice(0, 500) }));
  } catch {
    return [];
  }
}

/** The office manager's (or licensee's) note on an item before the pack goes. The licensee sees it. */
export async function saveItemNote(itemType: string, itemId: string, _prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const { profile, access } = await requireAuthContext();
  if (!access.runsOffice || access.isAgentPlan) return { error: "Only the office manager or the licensee in charge can add a note." };
  if (!ITEM_TYPES.has(itemType) || !/^[0-9a-f-]{36}$/i.test(itemId)) return { error: "Couldn't find that item. Reload the page." };
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000);
  const service = createServiceClient();
  const { error } = note
    ? await service.from("signoff_item_notes").upsert({
        agency_id: profile.agency_id,
        item_type: itemType,
        item_id: itemId,
        note,
        noted_by: profile.id,
        noted_by_name: nameOf(profile),
        noted_at: new Date().toISOString(),
      })
    : await service
        .from("signoff_item_notes")
        .delete()
        .eq("agency_id", profile.agency_id)
        .eq("item_type", itemType)
        .eq("item_id", itemId);
  if (error) return { error: "Couldn't save the note just now. Try again." };
  revalidatePath(PAGE);
  return { error: null, done: note ? "Note saved." : "Note removed." };
}

/**
 * Sends the month's pack to the licensee (Adam, 3 Nov 2026). Fixed once sent.
 * The licensee with a login sending it to themselves just starts signing. A
 * licensee with no login can't sign a pack yet, so it isn't sent.
 */
export async function sendPackToLicensee(_prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice || access.isAgentPlan) return { error: "Only the office manager or the licensee in charge can send the pack." };
  const service = createServiceClient();
  const office = await officeFor(service, profile.agency_id);
  if (!office) return { error: "Couldn't find your office. Reload the page." };
  if (!office.licensee.profileId) {
    return { error: `${office.licensee.name} isn't on RealComply yet, so they can't sign a pack. Their files keep going to them by email.` };
  }
  const packs = await packsFor(supabase, profile.agency_id);
  if (packs.open) return { error: `${monthName(packs.open.month)}'s pack is still waiting for the licensee's signature.` };
  const month = draftMonth(packs.sentMonths);
  if (String(formData.get("month") ?? "") !== month) return { error: "The pack changed while you had it open. Reload the page." };
  const items = await draftItems(supabase, profile.agency_id);
  if (items.length === 0) return { error: "Nothing is waiting for the licensee this month." };

  let packId: string;
  try {
    packId = await createPack(service, { agencyId: profile.agency_id, month, items, sender: { id: profile.id, name: nameOf(profile) } });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't send the pack just now. Try again." };
  }
  revalidatePath(PAGE);
  // The licensee signing for themselves needs no email.
  if (office.licensee.profileId === profile.id) return { error: null, done: "Ready to sign." };
  const sent = await emailPack(service, {
    office,
    packId,
    month,
    senderName: nameOf(profile),
    senderEmail: profile.email ?? null,
  });
  return sent.sent
    ? { error: null, done: `Sent to ${office.licensee.name}.` }
    : {
        error: null,
        done: `The pack is fixed, but the email to ${office.licensee.name} didn't send. Let them know it's waiting for them in RealComply.`,
      };
}

/** The licensee in charge signs the open pack in the app. */
export async function signPackInApp(_prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.officeLicensee) return { error: "Only the licensee in charge can sign the pack." };
  if (formData.get("reviewed") !== "yes") return { error: "Tick the box to confirm you've reviewed each item." };
  const service = createServiceClient();
  const office = await officeFor(service, profile.agency_id);
  const packs = await packsFor(supabase, profile.agency_id);
  if (!office || !packs.open || packs.open.id !== String(formData.get("packId") ?? "")) {
    return { error: "That pack isn't waiting to be signed any more. Reload the page." };
  }
  try {
    const r = await signPack(service, {
      office,
      pack: packs.open,
      signerId: profile.id,
      name: nameOf(profile),
      via: "app",
      holds: holdsFrom(formData),
    });
    revalidateAll();
    return { error: null, done: `Signed ${r.signed}.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't sign the pack just now. Try again." };
  }
}

/** The office profile setting (Adam, 3 Nov 2026): reminders only. */
export async function setSignoffMode(_prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const { supabase, access } = await requireAuthContext();
  if (!access.runsOffice || access.isAgentPlan) return { error: "Only the licensee in charge or the office manager can change this." };
  const mode = String(formData.get("mode") ?? "");
  const { error } = await supabase.rpc("set_licensee_signoff_mode", { p_mode: mode });
  if (error) return { error: error.code === "P0001" || error.code === "42501" ? error.message : "Couldn't save that. Try again." };
  revalidatePath("/dashboard/profile");
  revalidatePath(PAGE);
  return { error: null, done: "Saved." };
}

function revalidateAll() {
  for (const p of [PAGE, "/dashboard/trust", "/dashboard/sg-manual", "/dashboard/registers", "/dashboard/training-plans", "/dashboard/document-signoffs", "/dashboard"]) {
    revalidatePath(p);
  }
}

