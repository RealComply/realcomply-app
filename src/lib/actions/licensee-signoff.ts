"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/lib/actions/compliance";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appBaseUrl } from "@/lib/site-url";
import { createPack, draftItems, draftMonth, packsFor, signPack } from "@/lib/licensee-signoff/pack";
import { afterSigning, emailPack, licenseeLinkByToken, linkIsLive, officeFor } from "@/lib/licensee-signoff/server";
import { monthName } from "@/lib/licensee-signoff/model";

// The licensee's sign-off (Adam, 3 Nov 2026; 0109): the month's pack, and
// the licensee's emailed links. Who may do what is checked here; the writes
// go through the database's own functions (0109) with the server's key, so
// a licensee with no login can sign.

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
 * The licensee with a login sending it to themselves just starts signing.
 */
export async function sendPackToLicensee(_prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice || access.isAgentPlan) return { error: "Only the office manager or the licensee in charge can send the pack." };
  const service = createServiceClient();
  const office = await officeFor(service, profile.agency_id);
  if (!office) return { error: "Couldn't find your office. Reload the page." };
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
    createdBy: profile.id,
  });
  return sent.sent
    ? { error: null, done: `Sent to ${office.licensee.name}.` }
    : { error: null, done: `The pack is fixed, but the email to ${office.licensee.name} didn't send. Use Send again or Copy link.` };
}

/** Sends the open pack's email again, with a fresh link. */
export async function resendPack(): Promise<PackActionState> {
  const { supabase, profile, access } = await requireAuthContext();
  if (!access.runsOffice || access.isAgentPlan) return { error: "Only the office manager or the licensee in charge can send the pack." };
  const service = createServiceClient();
  const office = await officeFor(service, profile.agency_id);
  const packs = await packsFor(supabase, profile.agency_id);
  if (!office || !packs.open) return { error: "There's no pack waiting to be signed." };
  const sent = await emailPack(service, {
    office,
    packId: packs.open.id,
    month: packs.open.month,
    senderName: nameOf(profile),
    senderEmail: profile.email ?? null,
    createdBy: profile.id,
  });
  revalidatePath(PAGE);
  return sent.sent ? { error: null, done: `Sent again to ${office.licensee.name}.` } : { error: "The email didn't send. Try again, or use Copy link." };
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

/** A licensee signs through their emailed link: the month's pack, or one item. No login. */
export async function signByLink(token: string, _prev: PackActionState, formData: FormData): Promise<PackActionState> {
  const name = String(formData.get("typedName") ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Type your full name to sign." };
  if (name.length > 200) return { error: "That name is too long." };
  if (formData.get("confirmSelf") !== "yes") {
    return { error: "Tick the box to confirm you are the licensee in charge, signing for yourself." };
  }
  if (formData.get("reviewed") !== "yes") return { error: "Tick the box to confirm you've reviewed it." };
  const service = createServiceClient();
  const link = await licenseeLinkByToken(service, token);
  if (!link || !linkIsLive(link)) return { error: "This link can't be used any more. Ask the office to send a new one." };
  const agencyId = String(link.agency_id);
  const office = await officeFor(service, agencyId);
  if (!office) return { error: "This link can't be used any more. Ask the office to send a new one." };

  // Claim the link first, so it signs once however many times it is pressed.
  const { data: claimed } = await service
    .from("licensee_links")
    .update({ used_at: new Date().toISOString(), used_name: name })
    .eq("id", String(link.id))
    .is("used_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) return { error: "This link has already been used." };

  try {
    if (link.purpose === "pack") {
      const { data: pack } = await service
        .from("signoff_packs")
        .select("id, month, sent_at, sent_by_name, signed_at, signed_name, signed_via, signed_file_path, signed_file_name")
        .eq("id", String(link.pack_id))
        .eq("agency_id", agencyId)
        .maybeSingle();
      if (!pack) throw new Error("This pack can't be found. Ask the office to send it again.");
      await signPack(service, {
        office,
        pack: pack as Parameters<typeof signPack>[1]["pack"],
        signerId: null,
        name,
        via: "link",
        holds: holdsFrom(formData),
      });
    } else {
      const { data: signed, error } = await service.rpc("licensee_sign_item", {
        p_agency: agencyId,
        p_type: String(link.item_type),
        p_id: String(link.item_id),
        p_signer: null,
        p_name: name,
        p_via: "link",
        p_pack: null,
      });
      if (error) throw new Error(error.code === "P0001" ? error.message : "Couldn't sign it just now. Try again.");
      if (signed !== true) throw new Error("This has already been signed.");
      await afterSigning(service, agencyId, [{ type: String(link.item_type), id: String(link.item_id) }]);
    }
  } catch (err) {
    // Give the link back so they can try again.
    await service.from("licensee_links").update({ used_at: null, used_name: null }).eq("id", String(link.id));
    return { error: err instanceof Error ? err.message : "Couldn't sign it just now. Try again." };
  }
  revalidateAll();
  return { error: null, done: "Signed." };
}

/** Copy link (as the email job, 0107): recorded, then the link. */
export async function copyLicenseeLink(linkId: string): Promise<{ url: string | null; error: string | null }> {
  const { supabase } = await requireAuthContext();
  const { data, error } = await supabase.rpc("copy_licensee_link", { p_link_id: linkId });
  if (error || typeof data !== "string") {
    const said = error && (error.code === "P0001" || error.code === "42501") && error.message;
    return { url: null, error: said || "Couldn't copy the link just now. Try again." };
  }
  revalidatePath(PAGE);
  return { url: `${appBaseUrl()}/licensee/${data}`, error: null };
}

/** A person opened their link in a browser (OpenedBeacon). Never throws. */
export async function noteLicenseeLinkOpened(token: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("note_licensee_link_opened", { p_token: token });
  } catch {
    // An open not recorded only means "Not opened yet" a little longer.
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

